(() => {
  'use strict';

  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260915-s7-v30';
  const LOCAL_ADDITIONS_KEY = 'wlp:local-additions:v1';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const normalize = value => String(value ?? '').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();

  let masterByWid = new Map();
  let draftById = new Map();
  let rows = [];
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

  function readDrafts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_ADDITIONS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') : [];
    } catch { return []; }
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'});
  }

  function shorten(value, max = 180) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }

  function parseWidQuery(value) {
    const match = String(value || '').trim().match(/^(?:wid\s*:?\s*)?(\d+)$/i);
    return match ? String(Number(match[1])) : '';
  }

  function masterEditHref(wid) {
    const params = new URLSearchParams();
    params.set('wid', wid);
    params.set('return', 'editor-learning-metadata.html');
    return `./editor-local-edit.html?${params.toString()}`;
  }

  function draftEditHref(localId) {
    const params = new URLSearchParams();
    params.set('id', localId);
    params.set('return', 'editor-learning-metadata.html');
    return `./editor-draft-edit.html?${params.toString()}`;
  }

  function searchTextFor(item) {
    const meta = item.meta || {};
    const situations = Array.isArray(meta.situations) ? meta.situations : [];
    const alternatives = Array.isArray(meta.alternativeExpressions) ? meta.alternativeExpressions : [];
    return normalize([
      item.word,
      item.wid ? `wid${item.wid}` : '',
      item.wid ? `wid ${item.wid}` : '',
      item.entryLabel,
      meta.entryType,
      meta.senseHook,
      meta.memoryHook,
      ...situations.flatMap(situation => [situation?.title, situation?.anchor, situation?.communicativeNeed]),
      ...alternatives.flatMap(alternative => [alternative?.expression, alternative?.note])
    ].join(' '));
  }

  function rebuildRows() {
    const hooks = window.WLPLearningHooks;
    if (!hooks) { rows = []; return; }
    const metadata = hooks.all();
    const drafts = readDrafts();
    draftById = new Map(drafts.map((draft, index) => [String(draft.localId || '').trim(), {...draft, __index:index}]));

    rows = Object.entries(metadata).map(([key, meta]) => {
      const isMaster = key.startsWith('wid:');
      const wid = isMaster ? String(meta.wordId || key.slice(4)).trim() : '';
      const localId = !isMaster && key.startsWith('draft:') ? String(meta.localDraftId || key.slice(6)).trim() : '';
      const source = isMaster ? masterByWid.get(wid) : draftById.get(localId);
      const word = String(source?.Word || (isMaster ? `WID${wid}` : 'Missing Draft')).trim();
      const situations = Array.isArray(meta.situations) ? meta.situations : [];
      const alternatives = Array.isArray(meta.alternativeExpressions) ? meta.alternativeExpressions : [];
      const item = {
        key,
        meta,
        isMaster,
        wid,
        localId,
        word,
        source,
        entryLabel: isMaster ? `WID${wid}` : 'Draft',
        situationsCount: situations.length,
        alternativesCount: alternatives.length,
        editHref: isMaster ? masterEditHref(wid) : draftEditHref(localId)
      };
      item.searchText = searchTextFor(item);
      return item;
    }).sort((a, b) => {
      const timeA = Date.parse(a.meta?.updatedAt || '') || 0;
      const timeB = Date.parse(b.meta?.updatedAt || '') || 0;
      if (timeA !== timeB) return timeB - timeA;
      if (a.isMaster !== b.isMaster) return a.isMaster ? -1 : 1;
      return a.word.localeCompare(b.word, undefined, {sensitivity:'base'});
    });
  }

  function detailRow(label, value) {
    const clean = shorten(value);
    if (!clean) return '';
    return `<div class="learning-meta-detail"><span>${esc(label)}</span><p>${esc(clean)}</p></div>`;
  }

  function cardHtml(item) {
    const meta = item.meta || {};
    const type = String(meta.entryType || '').trim();
    const updated = formatDate(meta.updatedAt);
    const sourceMissing = !item.source;
    const topMeta = [item.entryLabel, type || '', updated ? `Updated ${updated}` : ''].filter(Boolean).join(' · ');
    const counts = `<span>${item.situationsCount} Situation${item.situationsCount === 1 ? '' : 's'}</span><span>${item.alternativesCount} Alternative${item.alternativesCount === 1 ? '' : 's'}</span>`;
    const missing = sourceMissing ? `<div class="learning-meta-warning">${item.isMaster ? 'Master card could not be resolved from the TSV, but this metadata record can still be opened by WID.' : 'The Draft card is missing on this device; this metadata record cannot be edited until the Draft exists.'}</div>` : '';
    const edit = sourceMissing && !item.isMaster
      ? `<span class="draft-manage-edit is-disabled" aria-disabled="true">Edit</span>`
      : `<a class="draft-manage-edit" href="${esc(item.editHref)}">Edit</a>`;
    return `<article class="draft-manage-card learning-meta-card" data-entry-key="${esc(item.key)}">
      <div class="draft-manage-main">
        <div class="draft-manage-word">${esc(item.word)}</div>
        <div class="draft-manage-meta">${esc(topMeta)}</div>
        <div class="learning-meta-counts">${counts}</div>
        <div class="learning-meta-details">
          ${detailRow('Sense', meta.senseHook)}
          ${detailRow('Memory', meta.memoryHook)}
        </div>
        ${missing}
      </div>
      <div class="draft-manage-actions">${edit}</div>
    </article>`;
  }

  function render() {
    rebuildRows();
    const list = $('learning-metadata-list');
    const empty = $('learning-metadata-empty');
    const metaLine = $('learning-metadata-results-meta');
    const countPill = $('learning-metadata-count-pill');
    if (!list || !empty) return;

    const input = $('learning-metadata-search');
    const rawQuery = String(input?.value || '').trim();
    const query = normalize(rawQuery);
    const widQuery = parseWidQuery(rawQuery);
    const filtered = !query ? rows : rows.filter(item => widQuery ? item.wid === widQuery : item.searchText.includes(query));

    if (countPill) countPill.textContent = `${rows.length} Metadata Entr${rows.length === 1 ? 'y' : 'ies'}`;
    if (metaLine) {
      const masterCount = rows.filter(item => item.isMaster).length;
      const draftCount = rows.length - masterCount;
      metaLine.textContent = rawQuery
        ? `Showing ${filtered.length} of ${rows.length} · ${masterCount} Master · ${draftCount} Draft`
        : `${rows.length} total · ${masterCount} Master · ${draftCount} Draft`;
    }

    if (loadError) {
      const warning = $('learning-metadata-load-warning');
      if (warning) { warning.hidden = false; warning.textContent = loadError; }
    }

    if (!rows.length) {
      list.innerHTML = '';
      empty.hidden = false;
      const title = empty.querySelector('h2');
      const copy = empty.querySelector('p');
      if (title) title.textContent = 'No Learning Metadata';
      if (copy) copy.textContent = 'Add Sense, Memory, Entry Type, Situations, or Alternatives from a card editor and it will appear here.';
      return;
    }

    if (!filtered.length) {
      list.innerHTML = '<div class="learning-meta-no-results">No Learning Metadata matches this search.</div>';
      empty.hidden = true;
      return;
    }

    empty.hidden = true;
    list.innerHTML = filtered.map(cardHtml).join('');
  }

  async function load() {
    loadError = '';
    try {
      const response = await fetch(TSV_URL, {cache:'no-store'});
      if (!response.ok) throw new Error(`TSV ${response.status}`);
      const master = parseTSV(await response.text());
      masterByWid = new Map(master.map(row => [String(row.WordID || '').trim(), row]).filter(([wid]) => wid));
    } catch (error) {
      masterByWid = new Map();
      loadError = 'The Master TSV could not be loaded. WIDs are still shown, but some headwords may be unavailable until the page is reloaded online.';
    }
    render();
  }

  $('learning-metadata-search')?.addEventListener('input', render);
  $('learning-metadata-clear')?.addEventListener('click', () => {
    const input = $('learning-metadata-search');
    if (!input) return;
    input.value = '';
    render();
    input.focus();
  });

  window.addEventListener('wlp-learning-hooks-changed', render);
  window.addEventListener('storage', event => {
    if ([window.WLPLearningHooks?.STORAGE_KEY, LOCAL_ADDITIONS_KEY].includes(event.key)) render();
  });
  window.addEventListener('pageshow', render);
  window.addEventListener('focus', render);

  load();
})();
