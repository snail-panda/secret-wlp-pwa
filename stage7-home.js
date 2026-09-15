(() => {
  const RECENT_KEY = 'wlp:stage7:recent-decks:v1';
  const menu = document.getElementById('menu-button');
  const drawer = document.getElementById('app-drawer');
  const close = document.getElementById('drawer-close');
  const backdrop = document.getElementById('drawer-backdrop');
  const toast = document.getElementById('home-toast');

  const setDrawer = open => {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    menu.setAttribute('aria-expanded', String(open));
    backdrop.hidden = !open;
  };
  menu?.addEventListener('click', () => setDrawer(true));
  close?.addEventListener('click', () => setDrawer(false));
  backdrop?.addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setDrawer(false); });

  document.getElementById('search-launch')?.addEventListener('click', () => {
    toast.hidden = false;
    clearTimeout(window.__wlpToastTimer);
    window.__wlpToastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  });

  let recent = [];
  try { recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch {}
  recent = Array.isArray(recent) ? recent.filter(Number.isFinite) : [];

  if (recent.length) {
    const latest = recent[0];
    const pad = String(latest).padStart(3, '0');
    const card = document.getElementById('continue-card');
    document.getElementById('continue-title').textContent = `Deck WLP${pad}`;
    document.getElementById('continue-link').href = `./flashcards/wlp/batch.html?batch=${pad}`;
    card.hidden = false;
  }

  const list = document.getElementById('recent-home-list');
  if (list && recent.length) {
    list.innerHTML = '';
    recent.slice(0, 3).forEach((deck, i) => {
      const pad = String(deck).padStart(3, '0');
      const a = document.createElement('a');
      a.className = 'recent-row';
      a.href = `./flashcards/wlp/batch.html?batch=${pad}`;
      a.innerHTML = `<span class="deck-no">#WLP${pad}</span><small>${i === 0 ? 'Most recent' : 'Recent deck'}</small><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>`;
      list.appendChild(a);
    });
  }
})();
