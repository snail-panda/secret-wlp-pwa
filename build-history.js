/* WLP v1.8.6.183 — Build History V1 + Study Set marker display. */
(() => {
  'use strict';
  const api = window.WLPStudyContext;
  const list = document.getElementById('build-history-list');
  const toast = document.getElementById('build-history-toast');
  const TEMP_SET_KEY = 'wlp:temporary-study-set:v1';
  const BUILDER_STATE_KEY = 'wlp:study-set-builder-state:v1';
  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv?v=20260909';
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.hidden = true; }, 2800);
  }

  function relativeWhen(value) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return 'Saved build';
    const diff = Math.max(0, Date.now() - time);
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'Just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return new Date(time).toLocaleDateString(undefined, {month:'short', day:'numeric', year:new Date(time).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined});
  }

  function scopeLabel(value) {
    return ({anywhere:'Anywhere',headword:'Headword','part-of-speech':'Part of Speech',synonyms:'Synonyms','card-content':'Card Content',classification:'Classification'})[clean(value)] || clean(value) || 'Anywhere';
  }

  function markerLabel(value) {
    return ({
      'needs-another-pass': 'Needs another pass',
      okay: 'Okay',
      solid: 'Solid'
    })[clean(value).toLowerCase()] || '';
  }

  function markerBadge(build) {
    const value = clean(build?.studyMarker).toLowerCase();
    const label = markerLabel(value);
    return label ? `<span class="build-history-marker is-${esc(value)}">${esc(label)}</span>` : '';
  }

  function criteriaLines(recipe) {
    const lines = [];
    const stages = Array.isArray(recipe?.searchStages) ? recipe.searchStages : [];
    stages.forEach((stage, index) => {
      const query = clean(stage?.query);
      if (!query) return;
      lines.push(`<div class="build-history-criterion"><strong>Search ${index + 1}</strong> · ${esc(scopeLabel(stage.scope))} · ${esc(clean(stage.mode).toUpperCase() || 'ALL')}<br>${esc(query)}</div>`);
    });
    const axes = recipe?.axes && typeof recipe.axes === 'object' ? recipe.axes : {};
    const defs = [['entryTypes','Entry Type'],['usageTags','Usage'],['topicTags','Topic'],['discoveryTags','Discovery']];
    defs.forEach(([key,label]) => {
      const axis = axes[key] || {};
      const include = Array.isArray(axis.include) ? axis.include.map(clean).filter(Boolean) : [];
      const exclude = Array.isArray(axis.exclude) ? axis.exclude.map(clean).filter(Boolean) : [];
      if (!include.length && !exclude.length) return;
      const parts = [];
      if (include.length) parts.push(`Include: ${include.join(', ')}${include.length > 1 ? ` (${clean(axis.mode).toUpperCase() || 'ANY'})` : ''}`);
      if (exclude.length) parts.push(`Exclude: ${exclude.join(', ')}`);
      lines.push(`<div class="build-history-criterion"><strong>${esc(label)}</strong><br>${esc(parts.join(' · '))}</div>`);
    });
    return lines.length ? lines.join('') : '<div class="build-history-criterion">No saved criteria summary is available for this Build.</div>';
  }

  function parseTSV(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const rows = [];
    const split = line => {
      const out=[]; let field=''; let quoted=false;
      for (let i=0;i<line.length;i++) { const ch=line[i]; if (ch==='"') { if (quoted && line[i+1]==='"') { field+='"'; i++; } else quoted=!quoted; } else if (ch==='\t' && !quoted) { out.push(field); field=''; } else field+=ch; }
      out.push(field); return out;
    };
    const headers = split(lines[0]);
    for (let i=1;i<lines.length;i++) { const values=split(lines[i]); const row={}; headers.forEach((h,j)=>row[h]=values[j] ?? ''); rows.push(row); }
    return rows;
  }

  async function sameSet(build) {
    try {
      const response = await fetch(TSV_URL, {cache:'no-store'});
      if (!response.ok) throw new Error(`TSV ${response.status}`);
      const byId = new Map(parseTSV(await response.text()).map(row => [clean(row.WordID), row]));
      const items = (build.wordIds || []).map(wordId => {
        const row = byId.get(clean(wordId));
        if (!row) return null;
        return {wordId:clean(row.WordID), batch:clean(row['Batch #']), word:clean(row.Word)};
      }).filter(Boolean);
      if (!items.length) { showToast('None of these saved cards are available in the current Master.'); return; }
      const snapshot = {version:1, createdAt:clean(build.createdAt) || new Date().toISOString(), criteria:build.recipe || {}, buildId:build.buildId, items};
      sessionStorage.setItem(TEMP_SET_KEY, JSON.stringify(snapshot));
      const first = items[0];
      const query = new URLSearchParams({batch:String(Number(first.batch) || first.batch).padStart(3,'0'), wordid:first.wordId, solo:'1', studyset:'1', from:'study-set', return:'../../build-history.html'});
      location.href = `./flashcards/wlp/batch.html?${query.toString()}`;
    } catch (error) {
      console.warn('WLP Build History same-set open failed:', error);
      showToast('This browser could not reopen the saved Build.');
    }
  }

  function rebuild(build) {
    if (!build?.recipe) { showToast('This Build recipe is no longer available.'); return; }
    try { sessionStorage.setItem(BUILDER_STATE_KEY, JSON.stringify(build.recipe)); }
    catch { showToast('This browser could not restore the Build recipe.'); return; }
    location.href = './study-set-builder.html';
  }

  function card(build) {
    const article = document.createElement('article');
    article.className = 'build-history-card';
    article.innerHTML = `<div class="build-history-summary" role="button" tabindex="0" aria-expanded="false"><div><div class="build-history-when">${esc(relativeWhen(build.lastUsedAt || build.createdAt))}<span class="build-history-count"><strong>${Number(build.cardCount || (build.wordIds || []).length || 0).toLocaleString()}</strong> cards</span></div><div class="build-history-meta"><span>Built set · exact snapshot saved</span>${markerBadge(build)}</div></div><svg class="build-history-summary-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></div><div class="build-history-detail"><span class="build-history-section-label">Saved criteria</span><div class="build-history-criteria">${criteriaLines(build.recipe)}</div><div class="build-history-actions"><button type="button" class="build-history-action is-primary" data-action="same">Study Same Set</button><button type="button" class="build-history-action" data-action="rebuild">Rebuild with Same Criteria</button></div><p class="build-history-note">Study Same Set uses the frozen saved card snapshot. Rebuild reruns the saved criteria against your current WLP data.</p></div>`;
    const summary = article.querySelector('.build-history-summary');
    const toggle = () => { const open = article.classList.toggle('is-open'); summary.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    summary.addEventListener('click', toggle);
    summary.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
    article.querySelector('[data-action="same"]').addEventListener('click', () => { void sameSet(build); });
    article.querySelector('[data-action="rebuild"]').addEventListener('click', () => rebuild(build));
    return article;
  }

  function render() {
    if (!list) return;
    const builds = api?.readBuildHistory?.() || [];
    if (!builds.length) { list.innerHTML = '<div class="build-history-empty">No meaningful Study Set builds have been saved yet. A Build is added here when you actually start studying or practicing a built set.</div>'; return; }
    list.replaceChildren(...builds.map(card));
  }
  render();
})();
