(() => {
  'use strict';

  const TSV_URL = './flashcards/wlp/wlp-flashcard-master.tsv';
  const PROGRESS_PREFIX = 'fc:wordid:';
  const PRACTICE_EVENTS_KEY = 'wlp:stage7:practice-events:v1';
  const ACTIVITY_EVENTS_KEY = 'wlp:stage7:activity-events:v1';
  const INTERACTION_EVENTS_KEY = 'wlp:stage7:interaction-events:v1';
  const LEARNING_SOURCE_VIEW_KEY = 'wlp:stage7:progress-learning-source:v1';
  const ACTIVITY_PERIOD_KEY = 'wlp:stage7:activity-period:v1';
  const PROGRESS_OPTIONS_KEY = 'wlp:stage7:progress-options:v1';
  const STUDYQ_SESSION_KEY = 'wlp:studyq-sessions:v1';
  const AI_STUDY_EVENT_KEY = 'wlp:ai-study-events:v1';
  const AI_ROUTE_STATE_KEY = 'wlp:ai-route-state:v1';
  const AI_LEARNER_PROFILE_KEY = 'wlp:ai-learner-profile:v1';
  const ACTIVITY_SOURCE_VIEW_KEY = 'wlp:stage7:progress-activity-source:v1';
  const WLP_UI_ROLE_KEY = 'wlp:ui-role:v2';
  const WLP_UI_SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const WLP_ADMIN_PASSWORD_SHA256 = 'd199aa3ab28923618bab089d78e8faa5e5004d0bc37c22ae5589454d575d192c';
  const RECENT_MS = 14 * 24 * 60 * 60 * 1000;
  const $ = id => document.getElementById(id);

  const VIEW_META = {
    overview: { title: 'Overview', description: 'See where you are, what needs attention, and what to do next.' },
    landscape: { title: 'Landscape', description: 'See the garden as a landscape: where you have traveled, and where you have not.' },
    paths: { title: 'Paths', description: 'See how Card, Standard and AI are building different routes through your vocabulary.' },
    activity: { title: 'Activity', description: 'See what you actually did over time—without turning progress into a single score.' }
  };

  const PANEL_OPTIONS = {
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

  let rows = [];
  let progressRecords = [];
  let practiceEvents = [];
  let activityEvents = [];
  let interactionEvents = [];
  let studyQSessions = [];
  let aiStudyEvents = [];
  let aiRouteState = {};
  let aiLearnerProfile = {};
  let rowByWordId = new Map();
  let activeView = 'overview';
  let activeActivityPeriod = localStorage.getItem(ACTIVITY_PERIOD_KEY) || '30d';
  let activeLearningSource = ['card', 'standard', 'ai'].includes(localStorage.getItem(LEARNING_SOURCE_VIEW_KEY)) ? localStorage.getItem(LEARNING_SOURCE_VIEW_KEY) : 'card';
  let activeActivitySource = ['all', 'card', 'standard', 'ai'].includes(localStorage.getItem(ACTIVITY_SOURCE_VIEW_KEY)) ? localStorage.getItem(ACTIVITY_SOURCE_VIEW_KEY) : 'all';

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
        if (row.some(v => String(v).trim())) table.push(row);
        row = []; field = '';
        continue;
      }
      field += ch;
    }
    row.push(field);
    if (row.some(v => String(v).trim())) table.push(row);
    if (!table.length) return [];
    const headers = table[0].map(v => String(v || '').trim());
    return table.slice(1).map(cols => Object.fromEntries(headers.map((h, i) => [h, String(cols[i] ?? '').trim()])));
  }

  function field(row, ...names) {
    for (const name of names) if (row && row[name]) return row[name];
    return '';
  }

  function wordIdOf(row) { return String(field(row, 'WordID', 'Word ID') || '').trim(); }
  function deckOf(row) { return Number(field(row, 'Batch #', 'Batch') || 0) || 0; }
  function pad3(value) { return String(Number(value) || 0).padStart(3, '0'); }
  function cardHrefForWordId(wordId) {
    const id = String(wordId || '').trim();
    const row = rowByWordId.get(id) || {};
    const deck = deckOf(row);
    if (deck && id) return `./flashcards/wlp/batch.html?batch=${encodeURIComponent(pad3(deck))}&wordid=${encodeURIComponent(id)}&solo=1`;
    if (deck) return `./flashcards/wlp/batch.html?batch=${encodeURIComponent(pad3(deck))}`;
    return '';
  }

  function firstPracticeWordId(event) {
    const values = [];
    if (event?.wordId) values.push(event.wordId);
    if (Array.isArray(event?.targets)) values.push(...event.targets);
    if (Array.isArray(event?.supports)) values.push(...event.supports);
    for (const value of values) {
      const id = typeof value === 'object' && value ? String(value.wordId || value.id || '') : String(value || '');
      if (id && rowByWordId.has(id)) return id;
    }
    return '';
  }

  function activityHref(event) {
    if (!event) return '';
    if (event.type === 'standard' && event.sessionId) return `./study-hub.html?session=${encodeURIComponent(String(event.sessionId))}`;
    const id = event.type === 'practice' ? firstPracticeWordId(event) : String(event.wordId || '').trim();
    return id ? cardHrefForWordId(id) : '';
  }

  function fmt(value) { return Number(value || 0).toLocaleString(); }

  function readProgressRecords() {
    const records = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PROGRESS_PREFIX)) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        const wordId = String(data.wordId || key.slice(PROGRESS_PREFIX.length)).trim();
        if (!wordId) continue;
        records.push({
          ...data,
          wordId,
          studyCount: Number(data.studyCount || 0),
          reviewCount: Number(data.reviewCount || 0),
          attempts: Number(data.attempts || 0),
          firstSeen: Number(data.firstSeen || 0),
          lastSeen: Number(data.lastSeen || 0),
          review: data.review === true || data.lastResult === 'review',
          reviewLevel: ['high', 'medium', 'light'].includes(String(data.reviewLevel || '').toLowerCase()) ? String(data.reviewLevel).toLowerCase() : '',
          reviewReasons: Array.isArray(data.reviewReasons) ? data.reviewReasons : [],
          lastReviewed: Number(data.lastReviewed || 0)
        });
      } catch (error) {
        console.warn('Could not read progress record:', key, error);
      }
    }
    return records;
  }

  function readPracticeEvents() {
    try {
      const data = JSON.parse(localStorage.getItem(PRACTICE_EVENTS_KEY) || '[]');
      return Array.isArray(data) ? data.filter(event => event && typeof event === 'object') : [];
    } catch (error) {
      console.warn('Could not read practice events:', error);
      return [];
    }
  }

  function readInteractionEvents() {
    try {
      const data = JSON.parse(localStorage.getItem(INTERACTION_EVENTS_KEY) || '[]');
      return Array.isArray(data) ? data.filter(event => event && typeof event === 'object') : [];
    } catch (error) {
      console.warn('Could not read interaction events:', error);
      return [];
    }
  }

  function readActivityEvents() {
    try {
      const data = JSON.parse(localStorage.getItem(ACTIVITY_EVENTS_KEY) || '[]');
      return Array.isArray(data) ? data.filter(event => event && typeof event === 'object') : [];
    } catch (error) {
      console.warn('Could not read activity events:', error);
      return [];
    }
  }

  function readStudyQSessions() {
    try {
      const data = JSON.parse(localStorage.getItem(STUDYQ_SESSION_KEY) || '[]');
      return Array.isArray(data) ? data.filter(session => session && typeof session === 'object' && session.sessionId) : [];
    } catch (error) {
      console.warn('Could not read Study Q sessions:', error);
      return [];
    }
  }

  function readAIStudyEvents() {
    try {
      const data = JSON.parse(localStorage.getItem(AI_STUDY_EVENT_KEY) || '[]');
      let list = [];
      if (Array.isArray(data)) list = data;
      else if (Array.isArray(data?.events)) list = data.events;
      else if (Array.isArray(data?.items)) list = data.items;
      else if (data?.records && typeof data.records === 'object') list = Array.isArray(data.records) ? data.records : Object.values(data.records);
      return list.filter(event => event && typeof event === 'object');
    } catch (error) {
      console.warn('Could not read AI Study events:', error);
      return [];
    }
  }

  function readAIRouteState() {
    try {
      const data = JSON.parse(localStorage.getItem(AI_ROUTE_STATE_KEY) || '{}');
      return data && typeof data === 'object' ? data : {};
    } catch (error) {
      console.warn('Could not read AI route state:', error);
      return {};
    }
  }

  function readAILearnerProfile() {
    try {
      const data = JSON.parse(localStorage.getItem(AI_LEARNER_PROFILE_KEY) || '{}');
      return data && typeof data === 'object' ? data : {};
    } catch (error) {
      console.warn('Could not read AI learner profile:', error);
      return {};
    }
  }

  function recentThreshold() { return Date.now() - RECENT_MS; }
  function stats() {
    const total = rows.length;
    const touched = progressRecords.filter(r => r.attempts > 0 || r.studyCount > 0 || r.reviewCount > 0 || r.lastSeen > 0).length;
    const review = progressRecords.filter(r => r.review).length;
    const recent = progressRecords.filter(r => r.lastSeen >= recentThreshold()).length;
    const unseen = Math.max(0, total - touched);
    const percent = total ? (touched / total) * 100 : 0;
    return { total, touched, review, recent, unseen, percent };
  }

  function formatWhen(timestamp) {
    if (!timestamp) return '—';
    const d = new Date(timestamp);
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const delta = Math.round((startToday - startThat) / 86400000);
    if (delta === 0) return 'Today';
    if (delta === 1) return 'Yesterday';
    if (delta > 1 && delta < 7) return `${delta}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function showToast(text, options = {}) {
    const toast = $('progress-toast');
    const isInfo = options.info === true;
    const infoDuration = Math.min(16000, Math.max(11000, 7000 + String(text || '').length * 30));
    const duration = Number(options.duration || (isInfo ? infoDuration : 2700));
    toast.textContent = text;
    toast.classList.toggle('is-info', isInfo);
    toast.hidden = false;
    clearTimeout(window.__wlpProgressToastTimer);
    window.__wlpProgressToastTimer = setTimeout(() => {
      toast.hidden = true;
      toast.classList.remove('is-info');
    }, duration);
  }

  function standardAttention(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ['none', 'light', 'medium', 'high'].includes(normalized) ? normalized : '';
  }

  function standardSourceMetrics(sessions = studyQSessions) {
    const metrics = {
      sessions: 0, experiences: 0, hints: 0, rated: 0, attentionSaved: 0, attentionMissing: 0,
      ratings: { 'got-it': 0, almost: 0, 'not-yet': 0, 'no-idea': 0 },
      attention: { none: 0, light: 0, medium: 0, high: 0 }
    };
    (Array.isArray(sessions) ? sessions : []).forEach(session => {
      metrics.sessions++;
      const experiences = Array.isArray(session?.experiences) ? session.experiences : [];
      metrics.experiences += Number(session?.experienceCount) || experiences.length;
      metrics.hints += Number(session?.hintCount) || 0;
      const counts = session?.counts || {};
      let sessionRatingTotal = 0;
      Object.keys(metrics.ratings).forEach(key => {
        const value = Number(counts[key]) || 0;
        metrics.ratings[key] += value;
        sessionRatingTotal += value;
      });
      if (experiences.length) {
        experiences.forEach(experience => {
          const attempt = experience?.attempt || {};
          const rating = String(attempt.selfRating || '').trim();
          if (rating && Object.prototype.hasOwnProperty.call(metrics.ratings, rating)) {
            metrics.rated++;
            if (!sessionRatingTotal) metrics.ratings[rating]++;
          }
          const attention = standardAttention(attempt.reviewAttention);
          if (attention) { metrics.attention[attention]++; metrics.attentionSaved++; }
          else if (rating) metrics.attentionMissing++;
        });
      } else {
        metrics.rated += sessionRatingTotal;
      }
    });
    return metrics;
  }

  function aiEventWordId(event) {
    return String(event?.wordId || event?.targetWordId || event?.target?.wordId || event?.selectedTarget?.wordId || '').trim();
  }

  function aiEventSessionId(event) {
    return String(event?.sessionId || event?.session?.sessionId || '').trim();
  }

  function aiEventEvidenceTypes(event) {
    const values = Array.isArray(event?.evidenceTypes) ? event.evidenceTypes
      : Array.isArray(event?.evidence?.evidenceTypes) ? event.evidence.evidenceTypes
        : Array.isArray(event?.evidenceSummary?.evidenceTypes) ? event.evidenceSummary.evidenceTypes : [];
    return values.map(value => String(value || '').trim()).filter(Boolean);
  }

  function aiAuthoritativeResponse(event) {
    return String(event?.authoritativeResponse || event?.learnerResponse?.authoritativeResponse || event?.learnerResponse?.text || '').trim();
  }

  function aiEventTimestamp(event) {
    const values = [event?.observedAt, event?.createdAt, event?.timestamp, event?.committedAt, event?.recordedAt, event?.interpretedAt, event?.receivedAt, event?.occurredAt, event?.updatedAt];
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
      const parsed = Date.parse(String(value || ''));
      if (parsed) return parsed;
    }
    return 0;
  }

  function aiEvidenceLabel(value) {
    const labels = {
      'recognition': 'Recognition',
      'cue-based-retrieval': 'Cue-based retrieval',
      'spontaneous-production': 'Spontaneous production',
      'context-transfer': 'Context transfer',
      'sense-transfer': 'Sense transfer',
      'reverse-reconstruction': 'Reverse reconstruction',
      'neighbor-discrimination': 'Neighbor discrimination',
      'free-composition': 'Free composition',
      'personal-anchor': 'Personal anchor',
      'form-control': 'Form control',
      'construction-use': 'Construction use'
    };
    const key = String(value || '').trim().toLowerCase();
    return labels[key] || titleCase(key);
  }

  function aiRouteRecords(routeState = aiRouteState) {
    const records = routeState && typeof routeState === 'object' ? routeState.records : null;
    return records && typeof records === 'object' && !Array.isArray(records) ? Object.values(records).filter(Boolean) : [];
  }

  function aiSourceMetrics(events = aiStudyEvents, routeState = aiRouteState, profile = aiLearnerProfile, options = {}) {
    const metrics = {
      events: 0, targets: 0, sessions: 0, evidenceRoutes: 0,
      evidence: {}, neighbors: 0, anchors: 0, connections: 0, weakRoutes: 0, diagnostics: 0,
      productionTendencies: 0, reusableConstructions: 0, styleTendencies: 0
    };
    const targetIds = new Set();
    const sessionIds = new Set();
    (Array.isArray(events) ? events : []).forEach(event => {
      metrics.events++;
      const wordId = aiEventWordId(event);
      const sessionId = aiEventSessionId(event);
      if (wordId) targetIds.add(wordId);
      if (sessionId) sessionIds.add(sessionId);
      const types = aiEventEvidenceTypes(event);
      types.forEach(type => {
        const key = String(type || '').trim().toLowerCase();
        if (!key) return;
        metrics.evidence[key] = (metrics.evidence[key] || 0) + 1;
      });
    });
    const routeEvidenceCounts = {};
    aiRouteRecords(routeState).forEach(record => {
      (Array.isArray(record?.routeEvidence) ? record.routeEvidence : []).forEach(item => {
        const key = String(item?.type || '').trim().toLowerCase();
        const count = Math.max(1, Number(item?.observationCount) || 0);
        if (key) routeEvidenceCounts[key] = (routeEvidenceCounts[key] || 0) + count;
      });
      metrics.neighbors += Array.isArray(record?.learnerGeneratedNeighbors) ? record.learnerGeneratedNeighbors.length : 0;
      metrics.anchors += Array.isArray(record?.personalAnchors) ? record.personalAnchors.length : 0;
      metrics.connections += Array.isArray(record?.connections) ? record.connections.length : 0;
      metrics.weakRoutes += Array.isArray(record?.weakOrFailedRoutes) ? record.weakOrFailedRoutes.length : 0;
      metrics.diagnostics += Array.isArray(record?.diagnosticExemplars) ? record.diagnosticExemplars.length : 0;
    });
    const eventEvidenceTotal = Object.values(metrics.evidence).reduce((sum, count) => sum + count, 0);
    const allowRouteFallback = options.routeFallback !== false;
    if (!eventEvidenceTotal && allowRouteFallback) Object.entries(routeEvidenceCounts).forEach(([key, count]) => { metrics.evidence[key] = count; });
    metrics.evidenceRoutes = eventEvidenceTotal || (allowRouteFallback ? Object.values(routeEvidenceCounts).reduce((sum, count) => sum + count, 0) : 0);
    const allowTargetFallback = options.targetFallback !== false;
    metrics.targets = targetIds.size || (allowTargetFallback ? aiRouteRecords(routeState).filter(record => String(record?.wordId || '').trim()).length : 0);
    metrics.sessions = sessionIds.size;
    metrics.productionTendencies = Array.isArray(profile?.productionTendencies) ? profile.productionTendencies.length : 0;
    metrics.reusableConstructions = Array.isArray(profile?.reusableConstructions) ? profile.reusableConstructions.length : 0;
    metrics.styleTendencies = Array.isArray(profile?.styleTendencies) ? profile.styleTendencies.length : 0;
    return metrics;
  }

  function cardSourceMetrics() {
    const directEvents = activityEvents.filter(event => eventTimestamp(event));
    const encountered = new Set();
    directEvents.forEach(event => {
      if (String(event.type || '').toLowerCase() === 'study' && event.wordId) encountered.add(String(event.wordId));
    });
    const actions = { studied: 0, review: 0, attention: 0 };
    interactionEvents.forEach(event => {
      const action = String(event?.action || '').toLowerCase();
      if (action === 'studied') actions.studied++;
      if (action === 'review' || action === 'added-to-review') actions.review++;
      if (action === 'attention_set') actions.attention++;
    });
    const recentCutoff = recentThreshold();
    const recentWords = new Set(directEvents.filter(event => eventTimestamp(event) >= recentCutoff).map(event => String(event.wordId || '')).filter(Boolean));
    return { encountered: encountered.size, recent: recentWords.size, ...actions, hasEventLog: directEvents.length > 0 };
  }

  function compactCountSummary(entries) {
    return entries.filter(([, value]) => Number(value) > 0).map(([label, value]) => `${fmt(value)} ${label}`).join(' · ');
  }

  function renderLearningSources() {
    const target = $('learning-source-summary');
    if (!target) return;
    document.querySelectorAll('[data-learning-source]').forEach(button => {
      const active = button.dataset.learningSource === activeLearningSource;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    if (activeLearningSource === 'ai') {
      const m = aiSourceMetrics();
      const evidenceText = Object.entries(m.evidence).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([type,count]) => `${fmt(count)} ${aiEvidenceLabel(type)}`).join(' · ') || 'No interpreted evidence recorded yet';
      const graphText = `${fmt(m.neighbors)} learner-generated neighbor${m.neighbors === 1 ? '' : 's'} · ${fmt(m.anchors)} personal anchor${m.anchors === 1 ? '' : 's'} · ${fmt(m.connections)} connection${m.connections === 1 ? '' : 's'} · ${fmt(m.weakRoutes)} weak/failed route${m.weakRoutes === 1 ? '' : 's'}`;
      const profileText = `${fmt(m.productionTendencies)} production tendenc${m.productionTendencies === 1 ? 'y' : 'ies'} · ${fmt(m.reusableConstructions)} reusable construction${m.reusableConstructions === 1 ? '' : 's'} · ${fmt(m.styleTendencies)} style tendenc${m.styleTendencies === 1 ? 'y' : 'ies'}`;
      target.innerHTML = `<div class="learning-source-kicker">AI Practice</div><div class="learning-source-stat-grid"><div><strong>${fmt(m.events)}</strong><span>Experiences</span></div><div><strong>${fmt(m.targets)}</strong><span>Targets</span></div><div><strong>${fmt(m.sessions)}</strong><span>Sessions</span></div><div><strong>${fmt(m.evidenceRoutes)}</strong><span>Evidence routes</span></div></div><div class="learning-source-signal"><span>Observed evidence</span><p>${escapeHtml(evidenceText)}</p></div><div class="learning-source-signal"><span>Learning graph</span><p>${escapeHtml(graphText)}</p></div><div class="learning-source-signal"><span>Profile evidence</span><p>${escapeHtml(profileText)}</p></div><p class="learning-source-note">AI evidence is descriptive. This view does not convert it into a self-rating or mastery score.</p>`;
      return;
    }

    if (activeLearningSource === 'standard') {
      const m = standardSourceMetrics();
      const ratingText = compactCountSummary([
        ['Got it', m.ratings['got-it']], ['Almost', m.ratings.almost], ['Not yet', m.ratings['not-yet']], ['No idea', m.ratings['no-idea']]
      ]) || 'No self-ratings recorded yet';
      const attentionText = compactCountSummary([
        ['None', m.attention.none], ['Light', m.attention.light], ['Medium', m.attention.medium], ['High', m.attention.high]
      ]) || 'No Review Attention choices recorded yet';
      target.innerHTML = `<div class="learning-source-kicker">Standard Practice</div><div class="learning-source-stat-grid"><div><strong>${fmt(m.sessions)}</strong><span>Sessions</span></div><div><strong>${fmt(m.experiences)}</strong><span>Experiences</span></div><div><strong>${fmt(m.rated)}</strong><span>Self-rated</span></div><div><strong>${fmt(m.hints)}</strong><span>Hints used</span></div></div><div class="learning-source-signal"><span>Self-rating</span><p>${escapeHtml(ratingText)}</p></div><div class="learning-source-signal"><span>Review Attention</span><p>${escapeHtml(attentionText)}</p></div>${m.attentionMissing ? `<p class="learning-source-note">${fmt(m.attentionMissing)} older rated experience${m.attentionMissing === 1 ? '' : 's'} have no separately saved Review Attention choice.</p>` : ''}`;
      return;
    }

    const m = cardSourceMetrics();
    target.innerHTML = `<div class="learning-source-kicker">Card Study</div><div class="learning-source-stat-grid"><div><strong>${fmt(m.encountered)}</strong><span>Words encountered</span></div><div><strong>${fmt(m.studied)}</strong><span>Studied choices</span></div><div><strong>${fmt(m.review)}</strong><span>Review choices</span></div><div><strong>${fmt(m.attention)}</strong><span>Attention sets</span></div></div><div class="learning-source-signal"><span>Recent direct card work</span><p>${fmt(m.recent)} word${m.recent === 1 ? '' : 's'} recorded in the last 14 days.</p></div><p class="learning-source-note">This source view uses timestamped Card Study events. Older cumulative state remains represented in the unified Overview above rather than being guessed into Card Study history.</p>`;
  }

  function renderOverview() {
    const s = stats();
    $('stat-touched').textContent = fmt(s.touched);
    $('stat-review').textContent = fmt(s.review);
    $('stat-recent').textContent = fmt(s.recent);
    $('stat-unseen').textContent = fmt(s.unseen);
    $('coverage-line-fill').style.width = `${Math.max(0, Math.min(100, s.percent))}%`;
    $('coverage-copy').textContent = `${fmt(s.touched)} of ${fmt(s.total)} cards recorded (${s.percent.toFixed(1)}% coverage)`;

    const reviewing = progressRecords.filter(r => r.review);
    const levels = { high: 0, medium: 0, light: 0, unassigned: 0 };
    reviewing.forEach(r => { if (r.reviewLevel) levels[r.reviewLevel]++; else levels.unassigned++; });
    $('attention-high').textContent = fmt(levels.high);
    $('attention-medium').textContent = fmt(levels.medium);
    $('attention-light').textContent = fmt(levels.light);
    const unassigned = $('attention-unassigned');
    unassigned.hidden = !levels.unassigned;
    unassigned.textContent = levels.unassigned ? `${fmt(levels.unassigned)} existing Review card${levels.unassigned === 1 ? '' : 's'} not yet assigned an attention level.` : '';

    const recentDecks = readNumberList('wlp:stage7:recent-decks:v1');
    $('next-new-copy').textContent = recentDecks.length ? `Continue near Deck WLP${pad3(recentDecks[0])}, or explore somewhere new` : 'Explore an area you have not covered yet';
    $('next-review-copy').textContent = s.review ? `${fmt(s.review)} card${s.review === 1 ? '' : 's'} currently asking for more attention` : 'No cards are currently marked Review';
    renderRecentActivity();
    renderLearningSources();
  }

  function renderRecentActivity() {
    const target = $('recent-activity');
    const items = progressRecords.filter(r => r.lastSeen).sort((a,b) => b.lastSeen - a.lastSeen).slice(0, 5);
    if (!items.length) {
      target.innerHTML = '<p class="empty-progress">Your Studied / Review activity will appear here as WLP records it.</p>';
      return;
    }
    target.innerHTML = items.map(record => {
      const row = rowByWordId.get(record.wordId) || {};
      const word = field(row, 'Word') || `WID ${record.wordId}`;
      const deck = deckOf(row);
      const tag = record.review ? 'Review' : 'Card Study';
      const href = cardHrefForWordId(record.wordId);
      const inner = `<span class="activity-time">${escapeHtml(formatWhen(record.lastSeen))}</span><span class="activity-main"><strong>${escapeHtml(word)}</strong><small>${deck ? `Deck WLP${pad3(deck)} · ` : ''}${fmt(record.attempts)} recorded interaction${record.attempts === 1 ? '' : 's'}</small></span><span class="activity-tag">${escapeHtml(tag)}</span>`;
      return href ? `<a class="activity-row" href="${href}">${inner}</a>` : `<div class="activity-row">${inner}</div>`;
    }).join('');
  }

  function readNumberList(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
    } catch { return []; }
  }

  function renderLandscape() {
    const s = stats();
    $('coverage-percent').textContent = `${s.percent.toFixed(1)}%`;
    $('coverage-touched').textContent = fmt(s.touched);
    $('coverage-review').textContent = fmt(s.review);
    $('coverage-recent').textContent = fmt(s.recent);
    $('coverage-unseen').textContent = fmt(s.unseen);
    $('coverage-donut').style.background = `conic-gradient(#5f9a79 0deg ${Math.max(0, Math.min(360, s.percent * 3.6))}deg, #e6ece8 ${Math.max(0, Math.min(360, s.percent * 3.6))}deg 360deg)`;

    renderDeckCoverageMap();

    const reviewing = progressRecords.filter(r => r.review);
    $('land-review-total').textContent = fmt(reviewing.length);
    $('land-review-old').textContent = fmt(reviewing.filter(r => !r.lastSeen || r.lastSeen < recentThreshold()).length);
    $('land-review-repeated').textContent = fmt(reviewing.filter(r => r.reviewCount >= 3).length);
    renderConnectionBars();
  }

  function renderDeckCoverageMap() {
    const target = $('deck-coverage-map');
    const maxDeck = rows.reduce((max, row) => Math.max(max, deckOf(row)), 0);
    const touchedByDeck = new Map();
    const reviewByDeck = new Map();
    const totalByDeck = new Map();

    rows.forEach(row => {
      const deck = deckOf(row);
      if (!deck) return;
      totalByDeck.set(deck, (totalByDeck.get(deck) || 0) + 1);
    });
    progressRecords.forEach(record => {
      const row = rowByWordId.get(record.wordId);
      const deck = deckOf(row);
      if (!deck) return;
      if (record.attempts || record.studyCount || record.reviewCount || record.lastSeen) touchedByDeck.set(deck, (touchedByDeck.get(deck) || 0) + 1);
      if (record.review) reviewByDeck.set(deck, (reviewByDeck.get(deck) || 0) + 1);
    });

    const rowsHtml = [];
    for (let rangeStart = 1; rangeStart <= maxDeck; rangeStart += 50) {
      const rangeEnd = Math.min(rangeStart + 49, maxDeck);
      const cells = [];
      for (let groupStart = rangeStart; groupStart <= rangeEnd; groupStart += 5) {
        const groupEnd = Math.min(groupStart + 4, rangeEnd);
        let touched = 0, total = 0, review = 0;
        for (let deck = groupStart; deck <= groupEnd; deck++) {
          touched += touchedByDeck.get(deck) || 0;
          total += totalByDeck.get(deck) || 0;
          review += reviewByDeck.get(deck) || 0;
        }
        const ratio = total ? touched / total : 0;
        const level = ratio === 0 ? 0 : ratio < .2 ? 1 : ratio < .5 ? 2 : ratio < .8 ? 3 : 4;
        const label = `Decks ${pad3(groupStart)}–${pad3(groupEnd)}: ${touched} of ${total} cards recorded${review ? `, ${review} in Review` : ''}`;
        cells.push(`<span class="map-cell" data-level="${level}" data-review="${review > 0}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></span>`);
      }
      rowsHtml.push(`<div class="map-row"><span class="map-range">${pad3(rangeStart)}–${pad3(rangeEnd)}</span><div class="map-cells">${cells.join('')}</div></div>`);
    }
    target.innerHTML = rowsHtml.join('') || '<p class="empty-progress">Deck map unavailable.</p>';
  }

  const connectionDefs = [
    ['Meaning', ['meaning','word-meaning','meaning-word','definition']],
    ['Context / Situation', ['story','dialogue','situation','context']],
    ['Usage / Collocation', ['usage','collocation','natural-usage','own-sentence']],
    ['Sound', ['pronunciation','sound']],
    ['Visual', ['visual','image']],
    ['Culture', ['culture','cultural-context']]
  ];

  function eventType(event) { return String(event.type || event.practiceType || '').trim().toLowerCase(); }
  function connectionCounts() {
    const counts = Object.fromEntries(connectionDefs.map(([label]) => [label, 0]));
    practiceEvents.forEach(event => {
      const type = eventType(event);
      const size = Math.max(1, (Array.isArray(event.targets) ? event.targets.length : 0) + (Array.isArray(event.supports) ? event.supports.length : 0));
      connectionDefs.forEach(([label, aliases]) => { if (aliases.includes(type)) counts[label] += size; });
    });
    return counts;
  }


  const EVIDENCE_PATH_DEFS = [
    { key: 'recall', label: 'Recall / Meaning', icon: 'book', copy: 'retrieval · recognition · meaning hooks' },
    { key: 'context', label: 'Context / Transfer', icon: 'context', copy: 'situations · real-life use · transfer' },
    { key: 'usage', label: 'Usage / Collocation', icon: 'usage', copy: 'natural use · collocation · phrasing' },
    { key: 'form', label: 'Form / Construction', icon: 'form', copy: 'patterns · construction · pronunciation' },
    { key: 'contrast', label: 'Contrast / Neighbors', icon: 'contrast', copy: 'nuance · alternatives · discrimination' },
    { key: 'anchors', label: 'Anchors / Exposure', icon: 'anchor', copy: 'personal anchors · repeated exposure' }
  ];

  function blankPathSignals() {
    return Object.fromEntries(EVIDENCE_PATH_DEFS.map(def => [def.key, { card: 0, standard: 0, ai: 0 }]));
  }

  function addPathSignal(signals, path, source, amount = 1) {
    if (!signals[path] || !Object.prototype.hasOwnProperty.call(signals[path], source)) return;
    const value = Number(amount) || 0;
    if (value > 0) signals[path][source] += value;
  }

  function cardPathSignals(signals, records = progressRecords) {
    const reasonMap = {
      recall: ['recall', 'meaning-hook'],
      context: ['context', 'real-life-use', 'better-example'],
      usage: ['usage', 'collocation'],
      form: ['pattern', 'pronunciation'],
      contrast: ['nuance'],
      anchors: ['more-exposure']
    };
    (Array.isArray(records) ? records : []).forEach(record => {
      if (!record?.review) return;
      const reasons = Array.isArray(record.reviewReasons) ? record.reviewReasons.map(value => String(value || '').trim().toLowerCase()).filter(Boolean) : [];
      Object.entries(reasonMap).forEach(([path, mapped]) => {
        mapped.forEach(reason => { if (reasons.includes(reason)) addPathSignal(signals, path, 'card', 1); });
      });
    });
  }

  function standardPathSignals(signals, sessions = studyQSessions) {
    (Array.isArray(sessions) ? sessions : []).forEach(session => {
      const experiences = Array.isArray(session?.experiences) ? session.experiences : [];
      if (experiences.length) {
        experiences.forEach(experience => {
          const attempt = experience?.attempt || {};
          if (!String(attempt.selfRating || '').trim()) return;
          addPathSignal(signals, 'recall', 'standard', 1);
          addPathSignal(signals, 'context', 'standard', 1);
        });
        return;
      }
      const count = Math.max(0, Number(session?.experienceCount) || Object.values(session?.counts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0));
      if (count) {
        addPathSignal(signals, 'recall', 'standard', count);
        addPathSignal(signals, 'context', 'standard', count);
      }
    });
  }

  function aiEvidencePath(type) {
    const key = String(type || '').trim().toLowerCase();
    if (['recognition', 'cue-based-retrieval', 'reverse-reconstruction'].includes(key)) return ['recall'];
    if (['context-transfer', 'sense-transfer'].includes(key)) return ['context'];
    if (['spontaneous-production', 'free-composition'].includes(key)) return ['context', 'usage'];
    if (['construction-use', 'form-control'].includes(key)) return ['form'];
    if (key === 'neighbor-discrimination') return ['contrast'];
    if (key === 'personal-anchor') return ['anchors'];
    return [];
  }

  function aiPathSignals(signals, events = aiStudyEvents, routeState = aiRouteState, profile = aiLearnerProfile) {
    let eventEvidenceCount = 0;
    (Array.isArray(events) ? events : []).forEach(event => {
      const seen = new Set();
      aiEventEvidenceTypes(event).forEach(type => {
        aiEvidencePath(type).forEach(path => {
          if (seen.has(path)) return;
          seen.add(path);
          addPathSignal(signals, path, 'ai', 1);
          eventEvidenceCount++;
        });
      });
    });
    const routeRecords = aiRouteRecords(routeState);
    if (!eventEvidenceCount) {
      routeRecords.forEach(record => {
        (Array.isArray(record?.routeEvidence) ? record.routeEvidence : []).forEach(item => {
          const amount = Math.max(1, Number(item?.observationCount) || 0);
          aiEvidencePath(item?.type).forEach(path => addPathSignal(signals, path, 'ai', amount));
        });
      });
    }
    routeRecords.forEach(record => {
      addPathSignal(signals, 'contrast', 'ai', Array.isArray(record?.learnerGeneratedNeighbors) ? record.learnerGeneratedNeighbors.length : 0);
      addPathSignal(signals, 'anchors', 'ai', Array.isArray(record?.personalAnchors) ? record.personalAnchors.length : 0);
    });
    addPathSignal(signals, 'form', 'ai', Array.isArray(profile?.reusableConstructions) ? profile.reusableConstructions.length : 0);
  }

  function evidenceAwarePathSignals(input = {}) {
    const signals = blankPathSignals();
    cardPathSignals(signals, input.progressRecords ?? progressRecords);
    standardPathSignals(signals, input.studyQSessions ?? studyQSessions);
    aiPathSignals(signals, input.aiStudyEvents ?? aiStudyEvents, input.aiRouteState ?? aiRouteState, input.aiLearnerProfile ?? aiLearnerProfile);
    return signals;
  }

  function pathSourceSignal(source, count) {
    const label = source === 'standard' ? 'Standard' : source === 'ai' ? 'AI' : 'Card';
    return `<span class="path-source-signal path-${source}-source${count ? '' : ' is-zero'}"><span>${label}</span><b>${fmt(count)}</b></span>`;
  }

  function renderConnectionBars() {
    const target = $('connection-bars');
    const counts = connectionCounts();
    const values = Object.values(counts);
    const max = Math.max(1, ...values);
    target.innerHTML = connectionDefs.map(([label]) => {
      const count = counts[label] || 0;
      const width = count ? Math.max(8, (count / max) * 100) : 0;
      return `<div class="connection-row"><span>${escapeHtml(label)}</span><div class="connection-track"><div class="connection-fill" style="width:${width}%"></div></div><b class="connection-count">${fmt(count)}</b></div>`;
    }).join('');
    $('connection-note').hidden = values.some(Boolean);
  }

  function renderPaths() {
    const signals = evidenceAwarePathSignals();
    $('learning-path-grid').innerHTML = EVIDENCE_PATH_DEFS.map(def => {
      const sourceCounts = signals[def.key] || { card: 0, standard: 0, ai: 0 };
      const contributing = ['card', 'standard', 'ai'].filter(source => Number(sourceCounts[source]) > 0).length;
      const stateCopy = contributing ? `${contributing} source${contributing === 1 ? '' : 's'} recorded here` : 'No recorded evidence here yet';
      return `<div class="learning-path-card" data-learning-path="${escapeHtml(def.key)}"><div class="learning-path-head">${pathIcon(def.icon)}<strong>${escapeHtml(def.label)}</strong></div><small>${escapeHtml(def.copy)}</small><div class="path-source-signals">${pathSourceSignal('card', sourceCounts.card)}${pathSourceSignal('standard', sourceCounts.standard)}${pathSourceSignal('ai', sourceCounts.ai)}</div><div class="path-evidence-state">${escapeHtml(stateCopy)}</div></div>`;
    }).join('');

    const reviewing = progressRecords.filter(r => r.review);
    const old = reviewing.filter(r => !r.lastSeen || r.lastSeen < recentThreshold()).length;
    $('focus-review-copy').textContent = old ? `${fmt(old)} current Review card${old === 1 ? '' : 's'} have not been seen in 14 days` : reviewing.length ? `${fmt(reviewing.length)} current Review card${reviewing.length === 1 ? '' : 's'}` : 'No cards are currently marked Review';

    const territory = findLightlyTouchedTerritory();
    $('focus-territory-copy').textContent = territory ? `Deck ${pad3(territory.start)}–${pad3(territory.end)} is the least-covered range right now` : 'Open Landscape to see a lightly touched deck range';
    renderRecentPractice();
  }

  function pathIcon(name) {
    const icons = {
      book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c3-.8 5.8-.2 8 1.7v12c-2.2-1.9-5-2.5-8-1.7v-12ZM20 5.5c-3-.8-5.8-.2-8 1.7v12c2.2-1.9 5-2.5 8-1.7v-12Z"/></svg>',
      context: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 3V5Z"/><path d="M8 9h8M8 12h5"/></svg>',
      usage: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M6 12h8M6 17h10"/><path d="m17 14 3 3-3 3"/></svg>',
      form: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M8 6v12M16 6v12M5 18h14"/><path d="M10.5 11h3M10.5 14h3"/></svg>',
      contrast: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="12" r="3"/><circle cx="17" cy="12" r="3"/><path d="M10 12h4"/></svg>',
      anchor: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><path d="M12 7v12M6 11H3c0 5 3.5 8 9 8s9-3 9-8h-3M8 15l4 4 4-4"/></svg>'
    };
    return icons[name] || icons.book;
  }

  function findLightlyTouchedTerritory() {
    if (!rows.length) return null;
    const maxDeck = rows.reduce((max, row) => Math.max(max, deckOf(row)), 0);
    const touched = new Set(progressRecords.filter(r => r.attempts || r.lastSeen).map(r => r.wordId));
    let best = null;
    for (let start = 1; start <= maxDeck; start += 50) {
      const end = Math.min(start + 49, maxDeck);
      const area = rows.filter(row => { const d = deckOf(row); return d >= start && d <= end; });
      if (!area.length) continue;
      const count = area.filter(row => touched.has(wordIdOf(row))).length;
      const ratio = count / area.length;
      if (!best || ratio < best.ratio) best = { start, end, ratio };
    }
    return best;
  }

  function renderRecentPractice() {
    const target = $('recent-practice');
    const items = [];

    activityEvents.forEach(event => {
      const timestamp = eventTimestamp(event);
      const wordId = String(event?.wordId || '').trim();
      if (!timestamp || !wordId) return;
      const row = rowByWordId.get(wordId) || {};
      const type = String(event?.type || 'study').trim().toLowerCase();
      const action = String(event?.action || '').trim().replace(/-/g, ' ');
      items.push({
        timestamp,
        title: field(row, 'Word') || `WID ${wordId}`,
        copy: action ? titleCase(action) : (type === 'review' ? 'Review card action' : 'Card encounter'),
        tag: 'Card',
        href: cardHrefForWordId(wordId)
      });
    });

    studyQSessions.forEach(session => {
      const timestamp = sessionTimestamp(session);
      if (!timestamp) return;
      const experiences = Number(session?.experienceCount) || (Array.isArray(session?.experiences) ? session.experiences.length : 0);
      items.push({
        timestamp,
        title: 'Standard Practice',
        copy: experiences ? `${experiences} experience${experiences === 1 ? '' : 's'}` : 'Completed session',
        tag: 'Standard',
        href: session?.sessionId ? `./study-hub.html?session=${encodeURIComponent(String(session.sessionId))}` : './study-hub.html'
      });
    });

    aiStudyEvents.forEach(event => {
      const timestamp = aiEventTimestamp(event);
      if (!timestamp) return;
      const wordId = aiEventWordId(event);
      const row = rowByWordId.get(wordId) || {};
      const evidence = aiEventEvidenceTypes(event).slice(0, 2).map(aiEvidenceLabel).join(' · ');
      items.push({
        timestamp,
        title: field(row, 'Word') || (wordId ? `WID ${wordId}` : 'AI Practice'),
        copy: evidence || 'AI learning evidence',
        tag: 'AI',
        href: wordId ? cardHrefForWordId(wordId) : './study-hub.html'
      });
    });

    practiceEvents.forEach(event => {
      const timestamp = eventTimestamp(event);
      if (!timestamp) return;
      const type = String(event.type || event.practiceType || 'Practice');
      const targets = Array.isArray(event.targets) ? event.targets.length : 0;
      const supports = Array.isArray(event.supports) ? event.supports.length : 0;
      items.push({
        timestamp,
        title: titleCase(type),
        copy: `${targets ? `${targets} target${targets === 1 ? '' : 's'}` : 'Connection practice'}${supports ? ` + ${supports} support` : ''}`,
        tag: 'Connection',
        href: activityHref({ ...event, type: 'practice' })
      });
    });

    const recent = items.filter(item => item.timestamp).sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
    if (!recent.length) {
      target.innerHTML = '<p class="empty-progress">No Card, Standard or AI practice has been recorded yet.</p>';
      return;
    }
    target.innerHTML = recent.map(item => {
      const inner = `<span class="practice-time">${escapeHtml(formatWhen(item.timestamp))}</span><span class="practice-main"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.copy)}</small></span><span class="practice-tag">${escapeHtml(item.tag)}</span>`;
      return item.href ? `<a class="practice-row" href="${item.href}">${inner}</a>` : `<div class="practice-row">${inner}</div>`;
    }).join('');
  }

  function titleCase(value) { return String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

  const ACTIVITY_PERIODS = {
    today: { label: 'Today', days: 1, buckets: 6 },
    '7d': { label: '7 Days', days: 7, buckets: 7 },
    '30d': { label: '30 Days', days: 30, buckets: 10 },
    '90d': { label: '3 Months', days: 90, buckets: 12 },
    '180d': { label: '6 Months', days: 180, buckets: 12 },
    all: { label: 'All Time', days: null, buckets: 12 }
  };

  function startOfToday() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function eventTimestamp(event) {
    return Number(event?.timestamp || event?.createdAt || event?.at || 0) || 0;
  }

  function selectedActivityRange() {
    const config = ACTIVITY_PERIODS[activeActivityPeriod] || ACTIVITY_PERIODS['30d'];
    const end = Date.now();
    if (activeActivityPeriod === 'today') return { ...config, start: startOfToday(), end };
    if (config.days == null) {
      const candidates = [];
      activityEvents.forEach(event => { const t = eventTimestamp(event); if (t) candidates.push(t); });
      practiceEvents.forEach(event => { const t = eventTimestamp(event); if (t) candidates.push(t); });
      studyQSessions.forEach(session => { const t = Date.parse(session.completedAt || session.endedAt || session.startedAt || '') || 0; if (t) candidates.push(t); });
      aiStudyEvents.forEach(event => { const t = aiEventTimestamp(event); if (t) candidates.push(t); });
      progressRecords.forEach(record => { if (record.firstSeen) candidates.push(record.firstSeen); if (record.lastSeen) candidates.push(record.lastSeen); });
      const start = candidates.length ? Math.min(...candidates) : startOfToday();
      return { ...config, start, end };
    }
    return { ...config, start: end - config.days * 86400000, end };
  }

  function inRange(timestamp, range) {
    return timestamp >= range.start && timestamp <= range.end;
  }

  function normalizedActivityStream(range) {
    const hasFullLog = activityEvents.some(event => eventTimestamp(event));
    const stream = [];
    if (hasFullLog) {
      activityEvents.forEach(event => {
        const timestamp = eventTimestamp(event);
        if (!timestamp || !inRange(timestamp, range)) return;
        stream.push({
          ...event,
          timestamp,
          wordId: String(event.wordId || '').trim(),
          type: String(event.type || event.action || 'study').toLowerCase(),
          legacy: false,
          source: event.source || 'card'
        });
      });
    } else {
      progressRecords.forEach(record => {
        if (!record.lastSeen || !inRange(record.lastSeen, range)) return;
        stream.push({
          timestamp: record.lastSeen,
          wordId: record.wordId,
          type: record.review ? 'review' : 'study',
          legacy: true,
          source: 'legacy-card'
        });
      });
    }

    practiceEvents.forEach(event => {
      const timestamp = eventTimestamp(event);
      if (!timestamp || !inRange(timestamp, range)) return;
      stream.push({
        ...event,
        timestamp,
        type: 'practice',
        practiceType: String(event.practiceType || event.type || 'practice').toLowerCase(),
        legacy: false,
        source: 'practice'
      });
    });

    studyQSessions.forEach(session => {
      const timestamp = sessionTimestamp(session);
      if (!timestamp || !inRange(timestamp, range)) return;
      const experiences = Array.isArray(session.experiences) ? session.experiences : [];
      const wordIds = Array.isArray(session.wordIds) && session.wordIds.length
        ? session.wordIds.map(String).filter(Boolean)
        : experiences.map(item => String(item?.wordId || '')).filter(Boolean);
      const reviewWordIds = experiences
        .filter(item => { const attention = standardAttention(item?.attempt?.reviewAttention); return attention && attention !== 'none'; })
        .map(item => String(item?.wordId || '')).filter(Boolean);
      stream.push({
        timestamp,
        type: 'standard',
        source: 'standard-practice',
        sessionId: String(session.sessionId || ''),
        sourceLabel: String(session.sourceLabel || 'Standard Practice'),
        wordIds,
        reviewWordIds,
        experienceCount: Number(session.experienceCount) || experiences.length,
        counts: session.counts || {},
        legacy: false
      });
    });
    aiStudyEvents.forEach(event => {
      const timestamp = aiEventTimestamp(event);
      if (!timestamp || !inRange(timestamp, range)) return;
      const evidenceTypes = aiEventEvidenceTypes(event);
      stream.push({
        ...event,
        timestamp,
        wordId: aiEventWordId(event),
        type: 'ai',
        source: 'ai-practice',
        sessionId: aiEventSessionId(event),
        evidenceTypes: evidenceTypes.map(value => String(value || '').trim()).filter(Boolean),
        legacy: false
      });
    });
    return stream.sort((a,b) => b.timestamp - a.timestamp);
  }

  function wordsFromActivityEvent(event) {
    const ids = [];
    if (event.wordId) ids.push(String(event.wordId));
    if (Array.isArray(event.wordIds)) ids.push(...event.wordIds.map(String));
    if (Array.isArray(event.targets)) ids.push(...event.targets.map(String));
    if (Array.isArray(event.supports)) ids.push(...event.supports.map(String));
    return ids.filter(Boolean);
  }

  function activityEncounterCount(event) {
    if (event.type === 'standard') return Math.max(1, Number(event.experienceCount) || (Array.isArray(event.wordIds) ? event.wordIds.length : 0));
    if (event.type === 'practice') {
      const count = (Array.isArray(event.targets) ? event.targets.length : 0) + (Array.isArray(event.supports) ? event.supports.length : 0);
      return Math.max(1, count);
    }
    return 1;
  }

  function activityStatsFor(range, stream) {
    const unique = new Set();
    const reviewWords = new Set();
    let encounters = 0;
    let practiceSessions = 0;
    const aiSessions = new Set();
    stream.forEach(event => {
      const ids = wordsFromActivityEvent(event);
      ids.forEach(id => unique.add(id));
      encounters += activityEncounterCount(event);
      if (event.type === 'review') ids.forEach(id => reviewWords.add(id));
      if (event.type === 'standard' && Array.isArray(event.reviewWordIds)) event.reviewWordIds.forEach(id => reviewWords.add(String(id)));
      if (event.type === 'practice' || event.type === 'standard') practiceSessions++;
      if (event.type === 'ai') {
        const key = String(event.sessionId || '').trim() || `event:${String(event.eventId || event.timestamp)}`;
        aiSessions.add(key);
      }
    });
    practiceSessions += aiSessions.size;
    progressRecords.forEach(record => {
      if (record.review && record.lastSeen && inRange(record.lastSeen, range)) reviewWords.add(record.wordId);
    });
    const firstTouched = progressRecords.filter(record => record.firstSeen && inRange(record.firstSeen, range)).length;
    const returned = progressRecords.filter(record => record.lastSeen && inRange(record.lastSeen, range) && record.firstSeen && record.firstSeen < range.start).length;
    return { unique: unique.size, encounters, reviewWords: reviewWords.size, practiceSessions, firstTouched, returned };
  }

  function bucketLabel(timestamp, index, count, periodKey) {
    const d = new Date(timestamp);
    if (periodKey === 'today') return d.toLocaleTimeString(undefined, { hour: 'numeric' }).replace(':00','');
    if (count <= 7 || index === 0 || index === count - 1 || index === Math.floor(count / 2)) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return '';
  }

  function renderActivityTrend(range, stream) {
    const target = $('activity-trend');
    const bucketCount = Math.max(1, range.buckets || 10);
    const span = Math.max(1, range.end - range.start);
    const bucketSize = span / bucketCount;
    const buckets = Array.from({length: bucketCount}, (_, i) => ({ count: 0, start: range.start + i * bucketSize }));
    stream.forEach(event => {
      let index = Math.floor((event.timestamp - range.start) / bucketSize);
      if (index < 0) index = 0;
      if (index >= bucketCount) index = bucketCount - 1;
      buckets[index].count += activityEncounterCount(event);
    });
    const max = Math.max(1, ...buckets.map(bucket => bucket.count));
    target.innerHTML = buckets.map((bucket, index) => {
      const height = bucket.count ? Math.max(5, (bucket.count / max) * 100) : 2;
      const label = bucketLabel(bucket.start, index, bucketCount, activeActivityPeriod);
      return `<div class="trend-bucket ${bucket.count ? '' : 'is-empty'}" title="${escapeHtml(label || formatWhen(bucket.start))}: ${fmt(bucket.count)} recorded encounter${bucket.count === 1 ? '' : 's'}"><span class="trend-value">${bucket.count ? fmt(bucket.count) : ''}</span><div class="trend-bar-wrap"><span class="trend-bar" style="height:${height}%"></span></div><span class="trend-label">${escapeHtml(label)}</span></div>`;
    }).join('');
    $('activity-trend-note').textContent = activeActivitySource === 'ai'
      ? 'Based on timestamped AI evidence events saved by WLP controlled merge.'
      : activeActivitySource === 'standard'
        ? 'Based on saved Standard Practice sessions.'
        : activeActivitySource === 'card'
          ? (activityEvents.length ? 'Based on timestamped Card Study event history.' : 'Legacy card progress can only reconstruct the latest recorded touch for each card.')
          : 'Combined chronology across available Card, Standard and AI records.';
  }

  function renderActivityMix(stream) {
    const counts = { Study: 0, Review: 0, Standard: 0, AI: 0, Practice: 0 };
    stream.forEach(event => {
      if (event.type === 'standard') counts.Standard += activityEncounterCount(event);
      else if (event.type === 'ai') counts.AI += activityEncounterCount(event);
      else if (event.type === 'practice') counts.Practice += activityEncounterCount(event);
      else if (event.type === 'review') counts.Review += 1;
      else counts.Study += 1;
    });
    const max = Math.max(1, ...Object.values(counts));
    $('activity-mix-list').innerHTML = Object.entries(counts).map(([label,count]) => `<div class="activity-mix-row"><span>${escapeHtml(label)}</span><div class="activity-mix-track"><div class="activity-mix-fill" style="width:${count ? Math.max(6,(count/max)*100) : 0}%"></div></div><b>${fmt(count)}</b></div>`).join('');
  }

  function activityTimelineTitle(event) {
    if (event.type === 'standard') return 'Standard Practice';
    if (event.type === 'ai') {
      const row = rowByWordId.get(String(event.wordId || '')) || {};
      return field(row, 'Word') || (event.wordId ? `WID ${event.wordId}` : 'AI Practice');
    }
    if (event.type === 'practice') return titleCase(event.practiceType || 'Practice');
    const row = rowByWordId.get(String(event.wordId || '')) || {};
    return field(row, 'Word') || (event.wordId ? `WID ${event.wordId}` : titleCase(event.type || 'Activity'));
  }

  function activityTimelineCopy(event) {
    if (event.type === 'ai') {
      const labels = (Array.isArray(event.evidenceTypes) ? event.evidenceTypes : []).slice(0, 3).map(aiEvidenceLabel);
      const response = aiAuthoritativeResponse(event);
      return [labels.join(' · '), response ? `Response: ${response}` : 'AI-interpreted learning evidence'].filter(Boolean).join(' · ');
    }
    if (event.type === 'standard') {
      const summary = studyQRatingSummary(event.counts || {});
      const count = Number(event.experienceCount) || (Array.isArray(event.wordIds) ? event.wordIds.length : 0);
      return [`${count} experience${count === 1 ? '' : 's'}`, event.sourceLabel, summary].filter(Boolean).join(' · ');
    }
    if (event.type === 'practice') {
      const targets = Array.isArray(event.targets) ? event.targets.length : 0;
      const supports = Array.isArray(event.supports) ? event.supports.length : 0;
      return `${targets ? `${targets} target${targets === 1 ? '' : 's'}` : 'Practice'}${supports ? ` + ${supports} support` : ''}`;
    }
    const row = rowByWordId.get(String(event.wordId || '')) || {};
    const deck = deckOf(row);
    return `${deck ? `Deck WLP${pad3(deck)} · ` : ''}${event.legacy ? 'latest recorded touch' : titleCase(event.source || 'card')}`;
  }

  function renderActivityTimeline(stream) {
    const target = $('activity-timeline');
    const items = stream.slice(0, 18);
    if (!items.length) {
      target.innerHTML = '<p class="empty-progress">No recorded activity in this time window.</p>';
      return;
    }
    target.innerHTML = items.map(event => {
      const tag = event.type === 'standard' ? 'Standard' : event.type === 'ai' ? 'AI' : event.type === 'practice' ? 'Practice' : event.type === 'review' ? 'Review' : 'Study';
      const inner = `<span class="timeline-time">${escapeHtml(formatWhen(event.timestamp))}</span><span class="timeline-main"><strong>${escapeHtml(activityTimelineTitle(event))}</strong><small>${escapeHtml(activityTimelineCopy(event))}</small></span><span class="timeline-tag">${escapeHtml(tag)}</span>`;
      const href = activityHref(event);
      return href ? `<a class="timeline-row" href="${href}">${inner}</a>` : `<div class="timeline-row">${inner}</div>`;
    }).join('');
  }

  function studyQRatingSummary(counts = {}) {
    const parts = [];
    if (counts['got-it']) parts.push(`${counts['got-it']} Got it`);
    if (counts.almost) parts.push(`${counts.almost} Almost`);
    if (counts['not-yet']) parts.push(`${counts['not-yet']} Not yet`);
    if (counts['no-idea']) parts.push(`${counts['no-idea']} No idea`);
    if (counts.unrated) parts.push(`${counts.unrated} not rated`);
    return parts.join(' · ');
  }

  function sessionTimestamp(session) {
    return Date.parse(session?.completedAt || session?.endedAt || session?.startedAt || '') || 0;
  }

  function renderStudyQSessions(range) {
    const sessions = studyQSessions
      .filter(session => { const timestamp = sessionTimestamp(session); return timestamp && inRange(timestamp, range); })
      .sort((a,b) => sessionTimestamp(b) - sessionTimestamp(a));
    const totalExperiences = sessions.reduce((sum, session) => sum + (Number(session.experienceCount) || (Array.isArray(session.experiences) ? session.experiences.length : 0)), 0);
    const totalHints = sessions.reduce((sum, session) => sum + (Number(session.hintCount) || 0), 0);
    const ratings = { 'got-it': 0, almost: 0, 'not-yet': 0, 'no-idea': 0, unrated: 0 };
    const attention = { none: 0, light: 0, medium: 0, high: 0 };
    let attentionMissing = 0;
    sessions.forEach(session => {
      const counts = session.counts || {};
      Object.keys(ratings).forEach(key => { ratings[key] += Number(counts[key]) || 0; });
      (Array.isArray(session.experiences) ? session.experiences : []).forEach(experience => {
        const attempt = experience?.attempt || {};
        const savedAttention = standardAttention(attempt.reviewAttention);
        if (savedAttention) attention[savedAttention]++;
        else if (String(attempt.selfRating || '').trim()) attentionMissing++;
      });
    });
    $('studyq-got-it').textContent = fmt(ratings['got-it']);
    $('studyq-almost').textContent = fmt(ratings.almost);
    $('studyq-not-yet').textContent = fmt(ratings['not-yet']);
    $('studyq-no-idea').textContent = fmt(ratings['no-idea']);
    $('studyq-attention-none').textContent = fmt(attention.none);
    $('studyq-attention-light').textContent = fmt(attention.light);
    $('studyq-attention-medium').textContent = fmt(attention.medium);
    $('studyq-attention-high').textContent = fmt(attention.high);
    const attentionNote = $('studyq-attention-note');
    attentionNote.hidden = !attentionMissing;
    attentionNote.textContent = attentionMissing ? `${fmt(attentionMissing)} older rated experience${attentionMissing === 1 ? '' : 's'} in this period have no separately saved Review Attention choice.` : '';
    const partialSessions = sessions.filter(session => session.status === 'ended-early' || session.status === 'incomplete').length;
    $('studyq-summary-line').innerHTML = sessions.length
      ? `<strong class="studyq-summary-number">${fmt(sessions.length)}</strong> saved session${sessions.length === 1 ? '' : 's'}${partialSessions ? ` · <strong class="studyq-summary-number">${fmt(partialSessions)}</strong> partial` : ''} · <strong class="studyq-summary-number">${fmt(totalExperiences)}</strong> experience${totalExperiences === 1 ? '' : 's'} · <strong class="studyq-summary-number">${fmt(totalHints)}</strong> hint${totalHints === 1 ? '' : 's'} used.`
      : 'No Standard Practice sessions recorded in this time window yet.';

    const target = $('studyq-session-list');
    const recent = sessions.slice(0, 8);
    if (!recent.length) {
      target.innerHTML = '<p class="empty-progress">Finish or end a Study Q session and it will appear here automatically.</p>';
      return;
    }
    target.innerHTML = recent.map(session => {
      const timestamp = sessionTimestamp(session);
      const count = Number(session.experienceCount) || (Array.isArray(session.experiences) ? session.experiences.length : 0);
      const source = String(session.sourceLabel || 'Study Q').trim();
      const ratingsText = studyQRatingSummary(session.counts || {});
      const deckText = Array.isArray(session.decks) && session.decks.length
        ? (session.decks.length === 1 ? `WLP${pad3(session.decks[0])}` : `${session.decks.length} decks`)
        : '';
      const planned = Number(session.plannedExperienceCount) || count;
      const isPartial = session.status === 'ended-early' || session.status === 'incomplete';
      const statusText = isPartial ? `${count}/${planned} experiences` : `${count} experience${count === 1 ? '' : 's'}`;
      const copy = [ statusText, deckText, ratingsText ].filter(Boolean).join(' · ');
      const href = `./study-hub.html?session=${encodeURIComponent(String(session.sessionId || ''))}`;
      const tag = session.status === 'ended-early' ? 'Ended early' : session.status === 'incomplete' ? 'Left early' : 'Open';
      return `<a class="studyq-session-row" href="${href}"><span class="studyq-session-time">${escapeHtml(formatWhen(timestamp))}</span><span class="studyq-session-main"><strong>${escapeHtml(source)}</strong><small>${escapeHtml(copy)}</small></span><span class="studyq-session-tag">${escapeHtml(tag)}</span></a>`;
    }).join('');
  }

  function renderAIEvidence(range) {
    const events = aiStudyEvents
      .filter(event => { const timestamp = aiEventTimestamp(event); return timestamp && inRange(timestamp, range); })
      .sort((a,b) => aiEventTimestamp(b) - aiEventTimestamp(a));
    const m = aiSourceMetrics(events, aiRouteState, aiLearnerProfile, { routeFallback: false, targetFallback: false });
    $('ai-event-count').textContent = fmt(m.events);
    $('ai-target-count').textContent = fmt(m.targets);
    $('ai-session-count').textContent = fmt(m.sessions);
    $('ai-route-count').textContent = fmt(m.evidenceRoutes);
    $('ai-summary-line').textContent = events.length
      ? `${fmt(m.events)} interpreted experience${m.events === 1 ? '' : 's'} across ${fmt(m.targets)} target${m.targets === 1 ? '' : 's'} and ${fmt(m.sessions)} session${m.sessions === 1 ? '' : 's'} in this time window.`
      : 'No AI Practice evidence recorded in this time window yet.';
    const evidenceTarget = $('ai-evidence-types');
    const evidenceEntries = Object.entries(m.evidence).sort((a,b) => b[1] - a[1]);
    evidenceTarget.innerHTML = evidenceEntries.length
      ? evidenceEntries.map(([type,count]) => `<span class="ai-evidence-chip"><b>${fmt(count)}</b>${escapeHtml(aiEvidenceLabel(type))}</span>`).join('')
      : '<p class="ai-evidence-empty">No evidence-route observations are available for this period yet.</p>';
    $('ai-graph-summary').textContent = `Current graph: ${fmt(m.neighbors)} learner-generated neighbors · ${fmt(m.anchors)} personal anchors · ${fmt(m.connections)} connections · ${fmt(m.weakRoutes)} weak/failed routes`;
    $('ai-profile-summary').textContent = `Profile evidence: ${fmt(m.productionTendencies)} production tendencies · ${fmt(m.reusableConstructions)} reusable constructions · ${fmt(m.styleTendencies)} style tendencies.`;
    const list = $('ai-recent-list');
    const recent = events.slice(0, 8);
    if (!recent.length) {
      list.innerHTML = '<p class="empty-progress">Complete an AI Practice experience and its merged evidence will appear here.</p>';
      return;
    }
    list.innerHTML = recent.map(event => {
      const timestamp = aiEventTimestamp(event);
      const wordId = aiEventWordId(event);
      const row = rowByWordId.get(wordId) || {};
      const title = field(row, 'Word') || (wordId ? `WID ${wordId}` : 'AI Practice');
      const evidenceTypes = aiEventEvidenceTypes(event);
      const evidenceText = evidenceTypes.slice(0, 3).map(aiEvidenceLabel).join(' · ') || 'Interpreted evidence';
      const response = aiAuthoritativeResponse(event);
      const copy = response ? `${evidenceText} · “${response}”` : evidenceText;
      const href = wordId ? cardHrefForWordId(wordId) : '';
      const inner = `<span class="ai-recent-time">${escapeHtml(formatWhen(timestamp))}</span><span class="ai-recent-main"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></span><span class="ai-recent-tag">Evidence</span>`;
      return href ? `<a class="ai-recent-row" href="${href}">${inner}</a>` : `<div class="ai-recent-row">${inner}</div>`;
    }).join('');
  }

  function activitySourceMatches(event, source = activeActivitySource) {
    if (source === 'all') return true;
    if (source === 'standard') return event.type === 'standard';
    if (source === 'ai') return event.type === 'ai';
    if (source === 'card') return event.type !== 'standard' && event.type !== 'ai' && event.type !== 'practice';
    return true;
  }

  function applyActivitySourceVisibility() {
    const saved = readPanelOptions();
    document.querySelectorAll('[data-activity-evidence-source]').forEach(panel => {
      const source = panel.dataset.activityEvidenceSource;
      const visibleBySource = activeActivitySource === 'all' || activeActivitySource === source;
      panel.hidden = !visibleBySource || saved[panel.dataset.panel] === false;
    });
  }

  function renderActivity() {
    if (!ACTIVITY_PERIODS[activeActivityPeriod]) activeActivityPeriod = '30d';
    const range = selectedActivityRange();
    const allStream = normalizedActivityStream(range);
    const stream = allStream.filter(event => activitySourceMatches(event));
    const s = activityStatsFor(range, stream);
    document.querySelectorAll('[data-activity-period]').forEach(button => button.classList.toggle('is-active', button.dataset.activityPeriod === activeActivityPeriod));
    document.querySelectorAll('[data-activity-source]').forEach(button => {
      const active = button.dataset.activitySource === activeActivitySource;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('activity-unique-words').textContent = fmt(s.unique);
    $('activity-encounters').textContent = fmt(s.encounters);
    $('activity-review-words').textContent = fmt(s.reviewWords);
    $('activity-practice-sessions').textContent = fmt(s.practiceSessions);
    $('activity-new-words').textContent = fmt(s.firstTouched);
    $('activity-returned-words').textContent = fmt(s.returned);
    $('activity-data-quality').textContent = activeActivitySource === 'ai'
      ? 'AI activity is read from controlled-merge evidence events. It is shown as evidence, not as a mastery score or automatic Review decision.'
      : activeActivitySource === 'standard'
        ? 'Standard Practice activity is read from saved session history. Self-rating and Review Attention remain separate signals.'
        : activeActivitySource === 'card'
          ? (activityEvents.length ? 'Full event history is available for recorded card activity in this period.' : 'Legacy mode: older card data cannot reconstruct interactions that were never timestamped.')
          : 'Combined Activity keeps Card, Standard and AI evidence in one chronology while preserving each source separately.';
    renderStudyQSessions(range);
    renderAIEvidence(range);
    renderActivityTrend(range, stream);
    renderActivityMix(stream);
    renderActivityTimeline(stream);
    applyActivitySourceVisibility();
  }

  function installLearningSourceControls() {
    document.querySelectorAll('[data-learning-source]').forEach(button => button.addEventListener('click', () => {
      const source = button.dataset.learningSource;
      if (!['card', 'standard', 'ai'].includes(source)) return;
      activeLearningSource = source;
      try { localStorage.setItem(LEARNING_SOURCE_VIEW_KEY, source); } catch (_) {}
      renderLearningSources();
    }));
  }

  function installActivityPeriodControls() {
    document.querySelectorAll('[data-activity-period]').forEach(button => button.addEventListener('click', () => {
      const period = button.dataset.activityPeriod;
      if (!ACTIVITY_PERIODS[period]) return;
      activeActivityPeriod = period;
      localStorage.setItem(ACTIVITY_PERIOD_KEY, period);
      renderActivity();
    }));
  }

  function installActivitySourceControls() {
    document.querySelectorAll('[data-activity-source]').forEach(button => button.addEventListener('click', () => {
      const source = button.dataset.activitySource;
      if (!['all', 'card', 'standard', 'ai'].includes(source)) return;
      activeActivitySource = source;
      try { localStorage.setItem(ACTIVITY_SOURCE_VIEW_KEY, source); } catch (_) {}
      renderActivity();
    }));
  }

  function renderAll() {
    progressRecords = readProgressRecords();
    practiceEvents = readPracticeEvents();
    activityEvents = readActivityEvents();
    interactionEvents = readInteractionEvents();
    studyQSessions = readStudyQSessions();
    aiStudyEvents = readAIStudyEvents();
    aiRouteState = readAIRouteState();
    aiLearnerProfile = readAILearnerProfile();
    const s = stats();
    $('progress-data-note').textContent = `${fmt(s.total)} cards · local progress`;
    renderOverview();
    renderLandscape();
    renderPaths();
    renderActivity();
    applyPanelOptions();
  }

  function progressViewFromUrl() {
    const requested = new URLSearchParams(location.search).get('view');
    return VIEW_META[requested] ? requested : 'overview';
  }

  function progressScrollFromUrl() {
    const raw = new URLSearchParams(location.search).get('scroll');
    if (raw === null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }

  function restoreProgressReturnScroll(scrollY) {
    if (!Number.isFinite(scrollY)) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: Math.max(0, scrollY), behavior: 'auto' });
      try {
        const url = new URL(location.href);
        url.searchParams.delete('scroll');
        const state = history.state && typeof history.state === 'object' ? history.state : {};
        history.replaceState({ ...state, wlpProgress: true, view: activeView, scrollY: Math.max(0, scrollY) }, '', url);
      } catch (_) {}
    }));
  }

  function saveProgressHistoryPosition() {
    try {
      const state = history.state && typeof history.state === 'object' ? history.state : {};
      history.replaceState({ ...state, wlpProgress: true, view: activeView, scrollY: Math.max(0, window.scrollY || 0) }, '', location.href);
    } catch (_) {}
  }

  function progressReviewHref(view) {
    const safeView = VIEW_META[view] ? view : activeView;
    return `./review.html?return=${encodeURIComponent(`progress.html?view=${safeView}`)}`;
  }

  function progressCardReturnHref() {
    const safeView = VIEW_META[activeView] ? activeView : 'overview';
    const params = new URLSearchParams();
    params.set('view', safeView);
    params.set('scroll', String(Math.max(0, Math.round(window.scrollY || 0))));
    return `../../progress.html?${params.toString()}`;
  }

  function prepareProgressCardReturn(event) {
    const link = event.target?.closest?.('a[href]');
    if (!link) return;
    try {
      const url = new URL(link.getAttribute('href') || '', location.href);
      if (url.origin !== location.origin || !url.pathname.endsWith('/flashcards/wlp/batch.html')) return;
      saveProgressHistoryPosition();
      url.searchParams.set('from', 'progress');
      url.searchParams.set('return', progressCardReturnHref());
      link.href = url.href;
    } catch (_) {}
  }

  function installProgressCardReturnNavigation() {
    document.addEventListener('pointerdown', prepareProgressCardReturn, true);
    document.addEventListener('click', prepareProgressCardReturn, true);
  }

  function refreshProgressReturnLinks() {
    document.querySelectorAll('[data-progress-return]').forEach(link => {
      const view = VIEW_META[link.dataset.progressReturn] ? link.dataset.progressReturn : activeView;
      link.setAttribute('href', progressReviewHref(view));
    });
  }

  function switchView(view, options = {}) {
    if (!VIEW_META[view]) view = 'overview';
    const previousView = activeView;
    const changed = previousView !== view;
    if (!options.skipUrl && changed) saveProgressHistoryPosition();
    activeView = view;
    document.querySelectorAll('[data-progress-view]').forEach(button => {
      const active = button.dataset.progressView === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.progress-view[data-view]').forEach(section => {
      const active = section.dataset.view === view;
      section.hidden = !active;
      section.classList.toggle('is-active', active);
    });
    $('progress-view-title').textContent = VIEW_META[view].title;
    $('progress-view-description').textContent = VIEW_META[view].description;
    if (!options.skipUrl && changed) {
      const url = new URL(location.href);
      url.searchParams.set('view', view);
      const state = { wlpProgress: true, view, scrollY: 0 };
      if (options.replaceUrl) history.replaceState(state, '', url);
      else history.pushState(state, '', url);
    }
    refreshProgressReturnLinks();
    requestAnimationFrame(() => {
      if (Number.isFinite(options.restoreScrollY)) {
        window.scrollTo({ top: Math.max(0, options.restoreScrollY), behavior: 'auto' });
        return;
      }
      if (options.targetSelector) {
        const target = document.querySelector(options.targetSelector);
        if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      }
      if (options.scrollTop) window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function readPanelOptions() {
    try {
      const saved = JSON.parse(localStorage.getItem(PROGRESS_OPTIONS_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch { return {}; }
  }

  function applyPanelOptions() {
    const saved = readPanelOptions();
    document.querySelectorAll('[data-panel]').forEach(panel => {
      const key = panel.dataset.panel;
      const source = panel.dataset.activityEvidenceSource;
      const visibleBySource = !source || activeActivitySource === 'all' || activeActivitySource === source;
      panel.hidden = saved[key] === false || !visibleBySource;
    });
    document.querySelectorAll('[data-progress-option]').forEach(input => {
      input.checked = saved[input.dataset.progressOption] !== false;
    });
  }

  function renderProgressOptions() {
    const saved = readPanelOptions();
    $('progress-options-groups').innerHTML = Object.entries(PANEL_OPTIONS).map(([group, items]) => `<section class="options-group"><h3>${escapeHtml(group)}</h3>${items.map(([key,label]) => `<label class="option-switch"><span>${escapeHtml(label)}</span><input type="checkbox" data-progress-option="${escapeHtml(key)}" ${saved[key] === false ? '' : 'checked'}></label>`).join('')}</section>`).join('');
    $('progress-options-groups').querySelectorAll('[data-progress-option]').forEach(input => {
      input.addEventListener('change', () => {
        const next = readPanelOptions();
        next[input.dataset.progressOption] = input.checked;
        localStorage.setItem(PROGRESS_OPTIONS_KEY, JSON.stringify(next));
        applyPanelOptions();
      });
    });
  }

  function installProgressOptions() {
    const sheet = $('progress-options-sheet');
    const backdrop = $('progress-options-backdrop');
    const open = () => {
      renderProgressOptions();
      backdrop.hidden = false;
      sheet.classList.add('is-open');
      sheet.setAttribute('aria-hidden', 'false');
    };
    const close = () => {
      sheet.classList.remove('is-open');
      sheet.setAttribute('aria-hidden', 'true');
      const optionsNav = $('progress-options-nav');
      if (optionsNav) {
        optionsNav.classList.remove('is-active');
        optionsNav.setAttribute('aria-selected', 'false');
      }
      setTimeout(() => { if (!sheet.classList.contains('is-open')) backdrop.hidden = true; }, 220);
    };
    const optionsNav = $('progress-options-nav');
    optionsNav.addEventListener('click', () => {
      optionsNav.classList.add('is-active');
      optionsNav.setAttribute('aria-selected', 'true');
      open();
    });
    $('progress-options-close').addEventListener('click', close);
    backdrop.addEventListener('click', close);
    $('progress-options-reset').addEventListener('click', () => {
      localStorage.removeItem(PROGRESS_OPTIONS_KEY);
      renderProgressOptions();
      applyPanelOptions();
      showToast('Default Progress panels restored.');
    });
    return close;
  }

  function installViewNavigation() {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    document.querySelectorAll('[data-progress-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.progressView, {scrollTop:true})));
    document.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => {
      const targetSelector = button.dataset.openViewTarget || '';
      switchView(button.dataset.openView, targetSelector ? { targetSelector } : { scrollTop:true });
    }));
    document.querySelectorAll('[data-toast]').forEach(button => button.addEventListener('click', () => showToast(button.dataset.toast, { info: true })));
    document.querySelectorAll('[data-progress-return]').forEach(link => link.addEventListener('click', saveProgressHistoryPosition));
    addEventListener('popstate', event => {
      const state = event.state && event.state.wlpProgress ? event.state : null;
      const view = state && VIEW_META[state.view] ? state.view : progressViewFromUrl();
      switchView(view, { skipUrl:true, restoreScrollY:Number(state?.scrollY) || 0 });
    });
    document.querySelectorAll('[data-practice-coming]').forEach(button => button.addEventListener('click', () => showToast('Context Practice is the next layer. This Progress foundation is ready to record it when we add it.')));
  }

  function installShell(closeOptions) {
    const menu = $('menu-button');
    const drawer = $('app-drawer');
    const close = $('drawer-close');
    const backdrop = $('drawer-backdrop');
    const rolePill = $('role-pill');
    const roleLabel = $('role-label');
    const roleMenu = $('role-menu');
    const roleMenuTitle = $('role-menu-title');
    const roleMenuCopy = $('role-menu-copy');
    const roleMenuAction = $('role-menu-action');
    const drawerRoleAction = $('drawer-role-action');
    const drawerAdminOnly = Array.from(document.querySelectorAll('.drawer-admin-only'));
    const adminGate = $('admin-gate');
    const adminForm = $('admin-form');
    const adminPassword = $('admin-password');
    const adminPasswordToggle = $('admin-password-toggle');
    const rememberAdmin = $('remember-admin');
    const adminError = $('admin-error');

    const setDrawer = open => {
      drawer.classList.toggle('open', open);
      drawer.setAttribute('aria-hidden', String(!open));
      menu.setAttribute('aria-expanded', String(open));
      backdrop.hidden = !open;
    };
    menu.addEventListener('click', () => setDrawer(true));
    close.addEventListener('click', () => setDrawer(false));
    backdrop.addEventListener('click', () => setDrawer(false));
    $('drawer-settings').addEventListener('click', () => { setDrawer(false); showToast('Settings will move into the Stage 7 app shell.'); });
    document.querySelectorAll('.drawer-placeholder').forEach(button => button.addEventListener('click', () => { setDrawer(false); showToast(button.dataset.placeholder || 'Coming soon.'); }));

    const getRole = () => (localStorage.getItem(WLP_UI_ROLE_KEY) === 'admin' || sessionStorage.getItem(WLP_UI_SESSION_ADMIN_KEY) === 'admin') ? 'admin' : 'guest';
    const clearAdmin = () => { localStorage.removeItem(WLP_UI_ROLE_KEY); sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY); };
    const setAdmin = remember => {
      if (remember) { localStorage.setItem(WLP_UI_ROLE_KEY,'admin'); sessionStorage.removeItem(WLP_UI_SESSION_ADMIN_KEY); }
      else { localStorage.removeItem(WLP_UI_ROLE_KEY); sessionStorage.setItem(WLP_UI_SESSION_ADMIN_KEY,'admin'); }
    };
    const refreshRoleUI = () => {
      const admin = getRole() === 'admin';
      roleLabel.textContent = admin ? 'Admin' : 'Guest';
      rolePill.classList.toggle('is-admin', admin);
      roleMenuTitle.textContent = admin ? 'Admin mode' : 'Guest mode';
      roleMenuCopy.textContent = admin ? 'Editing and import/export tools are unlocked.' : 'Study normally without editing tools.';
      roleMenuAction.textContent = admin ? 'Switch to Guest' : 'Admin Login';
      const drawerLabel = drawerRoleAction.querySelector('.drawer-role-label');
      if (drawerLabel) drawerLabel.textContent = admin ? 'Switch to Guest' : 'Admin Login';
      drawerAdminOnly.forEach(item => { item.hidden = !admin; });
    };
    const closeRoleMenu = () => { roleMenu.hidden = true; rolePill.setAttribute('aria-expanded','false'); };
    rolePill.addEventListener('click', event => { event.stopPropagation(); const open = roleMenu.hidden; roleMenu.hidden = !open; rolePill.setAttribute('aria-expanded', String(open)); });
    roleMenu.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', closeRoleMenu);

    const setPasswordVisible = visible => {
      adminPassword.type = visible ? 'text' : 'password';
      adminPasswordToggle?.setAttribute('aria-pressed', String(visible));
      adminPasswordToggle?.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
      adminPasswordToggle?.setAttribute('title', visible ? 'Hide password' : 'Show password');
    };
    adminPasswordToggle?.addEventListener('click', () => { const visible = adminPassword.type === 'text'; setPasswordVisible(!visible); adminPassword.focus({preventScroll:true}); });
    const openAdminGate = () => { closeRoleMenu(); setDrawer(false); adminError.hidden = true; adminPassword.value = ''; setPasswordVisible(false); rememberAdmin.checked = false; adminGate.hidden = false; setTimeout(() => adminPassword.focus(),0); };
    const closeAdminGate = () => { adminGate.hidden = true; adminError.hidden = true; adminPassword.value = ''; setPasswordVisible(false); };
    const roleAction = () => {
      if (getRole() === 'admin') { clearAdmin(); refreshRoleUI(); closeRoleMenu(); setDrawer(false); showToast('Switched to Guest mode.'); }
      else openAdminGate();
    };
    roleMenuAction.addEventListener('click', roleAction);
    drawerRoleAction.addEventListener('click', roleAction);
    $('admin-close').addEventListener('click', closeAdminGate);
    $('admin-cancel').addEventListener('click', closeAdminGate);
    adminGate.addEventListener('click', event => { if (event.target === adminGate) closeAdminGate(); });

    async function sha256Hex(text) {
      const bytes = new TextEncoder().encode(String(text));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
    }
    adminForm.addEventListener('submit', async event => {
      event.preventDefault();
      const hash = await sha256Hex(adminPassword.value);
      if (hash !== WLP_ADMIN_PASSWORD_SHA256) { adminError.hidden = false; adminPassword.select(); return; }
      setAdmin(rememberAdmin.checked); refreshRoleUI(); closeAdminGate(); showToast('Admin mode unlocked.');
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      setDrawer(false); closeRoleMenu(); closeAdminGate(); closeOptions();
    });
    refreshRoleUI();
  }

  function runSourceIntegrationSelfTest() {
    const checks = [];
    const check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
    const fixtures = [{ experienceCount: 2, hintCount: 1, counts: { 'got-it': 1, almost: 1 }, experiences: [
      { attempt: { selfRating: 'got-it', reviewAttention: 'medium' } },
      { attempt: { selfRating: 'almost', reviewAttention: 'light' } }
    ] }];
    const metrics = standardSourceMetrics(fixtures);
    check('standard sessions counted', metrics.sessions === 1);
    check('standard experiences counted', metrics.experiences === 2);
    check('self-ratings remain separate', metrics.ratings['got-it'] === 1 && metrics.ratings.almost === 1);
    check('attention remains separate', metrics.attention.medium === 1 && metrics.attention.light === 1);
    const aiEventsFixture = [
      { eventId: 'e1', sessionId: 's1', wordId: '5578', evidenceTypes: ['cue-based-retrieval'], observedAt: '2026-09-20T02:43:54.039Z' },
      { eventId: 'e2', sessionId: 's1', wordId: '5578', evidenceTypes: ['context-transfer','construction-use'], observedAt: '2026-09-20T02:44:54.039Z' },
      { eventId: 'e3', sessionId: 's2', wordId: '6000', evidenceTypes: ['spontaneous-production'], observedAt: '2026-09-20T02:45:54.039Z' }
    ];
    const aiRouteFixture = { records: { 'wid:5578': { wordId:'5578', learnerGeneratedNeighbors:[{}], personalAnchors:[{}], connections:[{},{}], weakOrFailedRoutes:[{}], routeEvidence:[{type:'cue-based-retrieval',observationCount:2},{type:'context-transfer',observationCount:1}] } } };
    const aiProfileFixture = { productionTendencies:[{}], reusableConstructions:[{},{}], styleTendencies:[] };
    const ai = aiSourceMetrics(aiEventsFixture, aiRouteFixture, aiProfileFixture);
    check('AI experiences counted', ai.events === 3);
    check('AI targets remain distinct', ai.targets === 2);
    check('AI sessions remain distinct', ai.sessions === 2);
    check('AI event evidence stays primary when events exist', ai.evidenceRoutes === 4);
    const aiFallback = aiSourceMetrics([], aiRouteFixture, aiProfileFixture);
    check('AI route state is a fallback when event evidence is unavailable', aiFallback.evidenceRoutes === 3 && aiFallback.evidence['cue-based-retrieval'] === 2 && aiFallback.targets === 1);
    const aiPeriodEmpty = aiSourceMetrics([], aiRouteFixture, aiProfileFixture, { routeFallback:false, targetFallback:false });
    check('empty AI period does not borrow all-time target/evidence counts', aiPeriodEmpty.targets === 0 && aiPeriodEmpty.evidenceRoutes === 0);
    check('AI graph data stays separate', ai.neighbors === 1 && ai.anchors === 1 && ai.connections === 2 && ai.weakRoutes === 1);
    check('AI profile evidence stays separate', ai.productionTendencies === 1 && ai.reusableConstructions === 2 && ai.styleTendencies === 0);
    check('AI timestamp accepts observedAt', aiEventTimestamp(aiEventsFixture[0]) === Date.parse('2026-09-20T02:43:54.039Z'));
    check('AI is one activity encounter per interpreted event', activityEncounterCount({ type:'ai' }) === 1);
    check('activity source filter keeps AI separate', activitySourceMatches({type:'ai'}, 'ai') && !activitySourceMatches({type:'standard'}, 'ai'));
    check('card filter excludes Standard and AI', activitySourceMatches({type:'study'}, 'card') && !activitySourceMatches({type:'standard'}, 'card') && !activitySourceMatches({type:'ai'}, 'card'));

    const pathSignals = evidenceAwarePathSignals({
      progressRecords: [
        { review:true, reviewReasons:['recall','usage','nuance'] },
        { review:true, reviewReasons:['context','pattern','more-exposure'] },
        { review:false, reviewReasons:['collocation'] }
      ],
      studyQSessions: [{ experiences:[
        { attempt:{selfRating:'got-it'} },
        { attempt:{selfRating:'almost'} },
        { attempt:{selfRating:''} }
      ] }],
      aiStudyEvents: [
        { evidenceTypes:['cue-based-retrieval','context-transfer'] },
        { evidenceTypes:['construction-use','neighbor-discrimination','personal-anchor'] },
        { evidenceTypes:['free-composition'] }
      ],
      aiRouteState: { records:{ one:{ learnerGeneratedNeighbors:[{}], personalAnchors:[{}], routeEvidence:[] } } },
      aiLearnerProfile: { reusableConstructions:[{}] }
    });
    check('Card paths use current Learning Needs only', pathSignals.recall.card === 1 && pathSignals.usage.card === 1 && pathSignals.context.card === 1 && pathSignals.form.card === 1 && pathSignals.contrast.card === 1 && pathSignals.anchors.card === 1);
    check('Standard situational ratings feed recall and context paths', pathSignals.recall.standard === 2 && pathSignals.context.standard === 2 && pathSignals.usage.standard === 0);
    check('AI evidence stays route-specific', pathSignals.recall.ai === 1 && pathSignals.context.ai === 2 && pathSignals.usage.ai === 1 && pathSignals.form.ai === 2 && pathSignals.contrast.ai === 2 && pathSignals.anchors.ai === 2);
    const fallbackPaths = evidenceAwarePathSignals({ progressRecords:[], studyQSessions:[], aiStudyEvents:[], aiRouteState:{records:{one:{routeEvidence:[{type:'cue-based-retrieval',observationCount:2},{type:'construction-use',observationCount:1}],learnerGeneratedNeighbors:[],personalAnchors:[]}}}, aiLearnerProfile:{} });
    check('AI route state is path fallback when event evidence is absent', fallbackPaths.recall.ai === 2 && fallbackPaths.form.ai === 1);
    check('Path source counts remain separate', ['card','standard','ai'].every(source => Object.prototype.hasOwnProperty.call(pathSignals.recall, source)));
    return { passed: checks.every(item => item.passed), checks };
  }

  function runEvidenceAwarePathsSelfTest() { return runSourceIntegrationSelfTest(); }

  window.WLPProgressStage7 = Object.freeze({ version: '1.3.3', runSourceIntegrationSelfTest, runEvidenceAwarePathsSelfTest });

  const closeOptions = installProgressOptions();
  installViewNavigation();
  installProgressCardReturnNavigation();
  installActivityPeriodControls();
  installActivitySourceControls();
  installLearningSourceControls();
  installShell(closeOptions);

  const requestedView = progressViewFromUrl();
  const requestedScrollY = progressScrollFromUrl();
  switchView(requestedView, {skipUrl:true});
  try {
    const initialState = history.state && typeof history.state === 'object' ? history.state : {};
    history.replaceState({ ...initialState, wlpProgress:true, view:requestedView, scrollY:Math.max(0, window.scrollY || 0) }, '', location.href);
  } catch (_) {}
  refreshProgressReturnLinks();

  fetch(TSV_URL, {cache:'no-cache'})
    .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); })
    .then(text => {
      rows = parseTSV(text);
      rowByWordId = new Map(rows.map(row => [wordIdOf(row), row]).filter(([id]) => id));
      renderAll();
      restoreProgressReturnScroll(requestedScrollY);
    })
    .catch(error => {
      console.error(error);
      progressRecords = readProgressRecords();
      practiceEvents = readPracticeEvents();
      activityEvents = readActivityEvents();
      interactionEvents = readInteractionEvents();
      studyQSessions = readStudyQSessions();
      aiStudyEvents = readAIStudyEvents();
      aiRouteState = readAIRouteState();
      aiLearnerProfile = readAILearnerProfile();
      $('progress-data-note').textContent = 'Deck data unavailable';
      renderOverview();
      renderLandscape();
      renderPaths();
      renderActivity();
      showToast('Progress opened, but the Master deck data could not be loaded.');
    });
})();
