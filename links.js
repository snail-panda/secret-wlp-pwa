(() => {
  'use strict';

  const STORAGE_KEY = 'wlp:links:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  const iconSvg = type => {
    if (type === 'sound') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9v6M9 6v12M13 4v16M17 7v10M21 10v4"/></svg>';
    if (type === 'book') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c3.2-.8 5.9-.2 8 1.7v12c-2.1-1.9-4.8-2.5-8-1.7v-12ZM20 5.5c-3.2-.8-5.9-.2-8 1.7v12c2.1-1.9 4.8-2.5 8-1.7v-12Z"/></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l2-2A5 5 0 0 0 12 3.9L10.9 5"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/></svg>';
  };

  const DEFAULT_STATE = {
    version: 1,
    categories: [
      {id:'pronunciation', title:'Pronunciation & Prosody', kicker:'Sound & rhythm', icon:'sound'},
      {id:'learning', title:'Fluency & Learning', kicker:'Learning shelf', icon:'book'}
    ],
    resources: [
      {id:'builtin-english-accent-coach', categoryId:'pronunciation', name:'English Accent Coach', description:'englishaccentcoach.com', actions:[{label:'Website',url:'https://www.englishaccentcoach.com/home'}]},
      {id:'builtin-sounds-american', categoryId:'pronunciation', name:'Sounds American', description:'Website + YouTube', actions:[{label:'Website',url:'https://soundsamerican.net/'},{label:'YouTube',url:'https://www.youtube.com/@SoundsAmerican'}]},
      {id:'builtin-tfcs-thought-groups', categoryId:'pronunciation', name:'TfCS — Tools for Clear Speech', description:'Thought Groups', actions:[{label:'Open reference',url:'https://tfcs.baruch.cuny.edu/thought-groups/'}]},
      {id:'builtin-wikihow-reading-fluency', categoryId:'learning', name:'wikiHow', description:'How to Improve Reading Fluency', actions:[{label:'Open article',url:'https://www.wikihow.life/Improve-Reading-Fluency'}]},
      {id:'builtin-reading-rockets-fluency', categoryId:'learning', name:'Reading Rockets', description:'Understanding and Assessing Fluency', actions:[{label:'Open article',url:'https://www.readingrockets.org/topics/assessment-and-evaluation/articles/understanding-and-assessing-fluency'}]},
      {id:'builtin-all-ears-english', categoryId:'learning', name:'AllEarsEnglishPodcast', description:'YouTube', actions:[{label:'YouTube',url:'https://www.youtube.com/@AllEarsEnglishPodcast'}]}
    ]
  };

  const clone = value => JSON.parse(JSON.stringify(value));
  const clean = value => String(value ?? '').trim();
  const makeId = prefix => {
    try { if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`; } catch (_) {}
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  };
  const isAdmin = () => localStorage.getItem(WLP_UI_ROLE_KEY) === 'admin' || sessionStorage.getItem(WLP_UI_SESSION_ADMIN_KEY) === 'admin';
  const normalizeUrl = value => {
    const raw = clean(value);
    if (!raw) return '';
    try {
      const url = new URL(raw);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch { return ''; }
  };
  const normalizeState = value => {
    const input = value && typeof value === 'object' ? value : {};
    const categories = Array.isArray(input.categories) ? input.categories.map((item,index) => ({
      id: clean(item?.id) || makeId('category'),
      title: clean(item?.title) || `Category ${index+1}`,
      kicker: clean(item?.kicker),
      icon: ['sound','book','link'].includes(item?.icon) ? item.icon : 'link'
    })) : [];
    const validCategories = new Set(categories.map(item => item.id));
    const fallbackCategory = categories[0]?.id || '';
    const resources = Array.isArray(input.resources) ? input.resources.map(item => ({
      id: clean(item?.id) || makeId('resource'),
      categoryId: validCategories.has(clean(item?.categoryId)) ? clean(item.categoryId) : fallbackCategory,
      name: clean(item?.name),
      description: clean(item?.description),
      actions: (Array.isArray(item?.actions) ? item.actions : []).map(action => ({label:clean(action?.label)||'Open',url:normalizeUrl(action?.url)})).filter(action => action.url).slice(0,2)
    })).filter(item => item.name && item.categoryId && item.actions.length) : [];
    return {version:1,categories,resources};
  };
  const readState = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return raw ? normalizeState(raw) : clone(DEFAULT_STATE);
    } catch { return clone(DEFAULT_STATE); }
  };
  const writeState = state => localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state), null, 2));

  let state = readState();
  let manageMode = false;

  const render = () => {
    const root = $('links-sections');
    if (!root) return;
    root.innerHTML = state.categories.map((category,categoryIndex) => {
      const resources = state.resources.filter(item => item.categoryId === category.id);
      const categoryControls = manageMode ? `<div class="links-manage-inline links-category-controls"><button type="button" data-category-up="${esc(category.id)}" ${categoryIndex===0?'disabled':''} aria-label="Move category up">↑</button><button type="button" data-category-down="${esc(category.id)}" ${categoryIndex===state.categories.length-1?'disabled':''} aria-label="Move category down">↓</button><button type="button" data-category-edit="${esc(category.id)}">Edit Category</button><button type="button" data-category-delete="${esc(category.id)}" ${resources.length?'disabled title="Move or delete links first"':''}>Delete</button></div>` : '';
      const cards = resources.map((item,index) => {
        const actions = item.actions.map(action => `<a href="${esc(action.url)}" target="_blank" rel="noopener noreferrer">${esc(action.label)} <span aria-hidden="true">↗</span></a>`).join('');
        const controls = manageMode ? `<div class="links-manage-inline resource-manage-actions"><button type="button" data-resource-up="${esc(item.id)}" ${index===0?'disabled':''} aria-label="Move link up">↑</button><button type="button" data-resource-down="${esc(item.id)}" ${index===resources.length-1?'disabled':''} aria-label="Move link down">↓</button><button type="button" data-resource-edit="${esc(item.id)}">Edit</button><button type="button" data-resource-delete="${esc(item.id)}">Delete</button></div>` : '';
        return `<article class="resource-card"><div class="resource-copy"><h3>${esc(item.name)}</h3>${item.description?`<p>${esc(item.description)}</p>`:''}</div><div class="resource-card-side"><div class="resource-actions">${actions}</div>${controls}</div></article>`;
      }).join('');
      return `<section class="links-section" aria-labelledby="links-category-${esc(category.id)}"><div class="links-section-head"><div class="links-section-icon" aria-hidden="true">${iconSvg(category.icon)}</div><div class="links-section-heading-copy"><span class="section-kicker">${esc(category.kicker)}</span><h2 id="links-category-${esc(category.id)}">${esc(category.title)}</h2></div>${categoryControls}</div><div class="links-grid">${cards || `<p class="links-category-empty">${manageMode?'No links in this category yet.':'No links yet.'}</p>`}</div></section>`;
    }).join('') || '<p class="links-category-empty">No link categories yet.</p>';
    bindRenderedActions();
  };

  const saveAndRender = () => { writeState(state); render(); };
  const syncAdminUi = () => {
    const admin = isAdmin();
    const launch = $('links-manage-launch');
    if (launch) launch.hidden = !admin;
    if (!admin && manageMode) {
      manageMode = false;
      $('links-manage-bar').hidden = true;
      closeEditors();
      render();
    }
  };

  const setManageMode = enabled => {
    if (enabled && !isAdmin()) return;
    manageMode = Boolean(enabled);
    $('links-manage-bar').hidden = !manageMode;
    $('links-manage-launch').textContent = manageMode ? 'Managing Links' : 'Manage Links';
    render();
  };

  const categoryOptions = selected => state.categories.map(category => `<option value="${esc(category.id)}" ${category.id===selected?'selected':''}>${esc(category.title)}</option>`).join('');
  const openResourceEditor = resource => {
    if (!isAdmin()) return;
    const item = resource || {id:'',categoryId:state.categories[0]?.id||'',name:'',description:'',actions:[{label:'Website',url:''}]};
    if (!state.categories.length) { openCategoryEditor(null); return; }
    $('links-editor-title').textContent = resource ? 'Edit Link' : 'Add Link';
    $('links-editor-id').value = item.id || '';
    $('links-editor-name').value = item.name || '';
    $('links-editor-description').value = item.description || '';
    $('links-editor-category').innerHTML = categoryOptions(item.categoryId);
    $('links-editor-label-1').value = item.actions?.[0]?.label || 'Website';
    $('links-editor-url-1').value = item.actions?.[0]?.url || '';
    $('links-editor-label-2').value = item.actions?.[1]?.label || '';
    $('links-editor-url-2').value = item.actions?.[1]?.url || '';
    openModal('links-editor-modal');
    setTimeout(() => $('links-editor-name')?.focus(), 0);
  };
  const openCategoryEditor = category => {
    if (!isAdmin()) return;
    $('links-category-title').textContent = category ? 'Edit Category' : 'Add Category';
    $('links-category-id').value = category?.id || '';
    $('links-category-name').value = category?.title || '';
    $('links-category-kicker').value = category?.kicker || '';
    openModal('links-category-modal');
    setTimeout(() => $('links-category-name')?.focus(), 0);
  };
  const openModal = id => {
    $('links-editor-backdrop').hidden = false;
    const modal = $(id); if (!modal) return;
    modal.hidden = false; modal.setAttribute('aria-hidden','false');
    document.body.classList.add('links-modal-open');
  };
  const closeEditors = () => {
    $('links-editor-backdrop').hidden = true;
    ['links-editor-modal','links-category-modal'].forEach(id => { const modal=$(id); if(modal){modal.hidden=true;modal.setAttribute('aria-hidden','true');} });
    document.body.classList.remove('links-modal-open');
  };

  const moveResource = (id, direction) => {
    const currentIndex = state.resources.findIndex(item => item.id === id);
    if (currentIndex < 0) return;
    const item = state.resources[currentIndex];
    const same = state.resources.map((value,index) => ({value,index})).filter(entry => entry.value.categoryId === item.categoryId);
    const position = same.findIndex(entry => entry.index === currentIndex);
    const target = same[position + direction];
    if (!target) return;
    const [moved] = state.resources.splice(currentIndex,1);
    const targetIndexAfterRemoval = state.resources.findIndex(value => value.id === target.value.id);
    state.resources.splice(direction < 0 ? targetIndexAfterRemoval : targetIndexAfterRemoval + 1,0,moved);
    saveAndRender();
  };
  const moveCategory = (id,direction) => {
    const index=state.categories.findIndex(item=>item.id===id), target=index+direction;
    if(index<0||target<0||target>=state.categories.length)return;
    [state.categories[index],state.categories[target]]=[state.categories[target],state.categories[index]];
    saveAndRender();
  };

  function bindRenderedActions() {
    document.querySelectorAll('[data-resource-edit]').forEach(button => button.addEventListener('click', () => openResourceEditor(state.resources.find(item => item.id === button.dataset.resourceEdit))));
    document.querySelectorAll('[data-resource-delete]').forEach(button => button.addEventListener('click', () => {
      const item=state.resources.find(value=>value.id===button.dataset.resourceDelete); if(!item) return;
      if(!confirm(`Delete “${item.name}” from this browser's Links shelf?`)) return;
      state.resources=state.resources.filter(value=>value.id!==item.id); saveAndRender();
    }));
    document.querySelectorAll('[data-resource-up]').forEach(button => button.addEventListener('click', () => moveResource(button.dataset.resourceUp,-1)));
    document.querySelectorAll('[data-resource-down]').forEach(button => button.addEventListener('click', () => moveResource(button.dataset.resourceDown,1)));
    document.querySelectorAll('[data-category-edit]').forEach(button => button.addEventListener('click', () => openCategoryEditor(state.categories.find(item=>item.id===button.dataset.categoryEdit))));
    document.querySelectorAll('[data-category-delete]').forEach(button => button.addEventListener('click', () => {
      const id=button.dataset.categoryDelete, category=state.categories.find(item=>item.id===id); if(!category) return;
      if(state.resources.some(item=>item.categoryId===id)) return;
      if(!confirm(`Delete category “${category.title}”?`)) return;
      state.categories=state.categories.filter(item=>item.id!==id); saveAndRender();
    }));
    document.querySelectorAll('[data-category-up]').forEach(button => button.addEventListener('click', () => moveCategory(button.dataset.categoryUp,-1)));
    document.querySelectorAll('[data-category-down]').forEach(button => button.addEventListener('click', () => moveCategory(button.dataset.categoryDown,1)));
  }

  $('links-manage-launch')?.addEventListener('click', () => setManageMode(!manageMode));
  $('links-manage-done')?.addEventListener('click', () => setManageMode(false));
  $('links-add-resource')?.addEventListener('click', () => openResourceEditor(null));
  $('links-add-category')?.addEventListener('click', () => openCategoryEditor(null));
  $('links-reset-defaults')?.addEventListener('click', () => {
    if (!isAdmin() || !confirm('Reset this browser’s Links shelf to the built-in defaults? Local link and category changes will be removed.')) return;
    localStorage.removeItem(STORAGE_KEY); state=clone(DEFAULT_STATE); render();
  });

  $('links-editor-form')?.addEventListener('submit', event => {
    event.preventDefault(); if(!isAdmin()) return;
    const name=clean($('links-editor-name').value), categoryId=clean($('links-editor-category').value), url1=normalizeUrl($('links-editor-url-1').value), url2=normalizeUrl($('links-editor-url-2').value);
    if(!name||!categoryId||!url1){ if(!url1) $('links-editor-url-1').setCustomValidity('Enter a valid http(s) URL.'); $('links-editor-url-1').reportValidity(); $('links-editor-url-1').setCustomValidity(''); return; }
    const id=clean($('links-editor-id').value)||makeId('resource');
    const actions=[{label:clean($('links-editor-label-1').value)||'Open',url:url1}];
    if(url2) actions.push({label:clean($('links-editor-label-2').value)||'Open',url:url2});
    const next={id,categoryId,name,description:clean($('links-editor-description').value),actions};
    const index=state.resources.findIndex(item=>item.id===id);
    if(index>=0) state.resources[index]=next; else state.resources.push(next);
    closeEditors(); saveAndRender();
  });
  $('links-category-form')?.addEventListener('submit', event => {
    event.preventDefault(); if(!isAdmin()) return;
    const title=clean($('links-category-name').value); if(!title) return;
    const id=clean($('links-category-id').value)||makeId('category');
    const index=state.categories.findIndex(item=>item.id===id);
    const next={id,title,kicker:clean($('links-category-kicker').value),icon:index>=0?state.categories[index].icon:'link'};
    if(index>=0) state.categories[index]=next; else state.categories.push(next);
    closeEditors(); saveAndRender();
  });

  ['links-editor-close','links-editor-cancel','links-category-close','links-category-cancel'].forEach(id => $(id)?.addEventListener('click', closeEditors));
  $('links-editor-backdrop')?.addEventListener('click', closeEditors);
  document.addEventListener('keydown', event => { if(event.key==='Escape'&&!$('links-editor-backdrop')?.hidden) closeEditors(); });
  window.addEventListener('storage', event => {
    if(event.key===STORAGE_KEY){state=readState();render();}
    if(event.key===WLP_UI_ROLE_KEY) syncAdminUi();
  });
  window.addEventListener('pageshow', () => { state=readState();syncAdminUi();render(); });
  window.addEventListener('focus', syncAdminUi);
  const roleLabel=$('role-label'); if(roleLabel) new MutationObserver(syncAdminUi).observe(roleLabel,{childList:true,subtree:true,characterData:true});

  syncAdminUi();
  render();
})();
