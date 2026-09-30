/* WLP Supabase Shadow Mode v0-A — READ-ONLY local scanner.
   No cloud transport. No writes to existing WLP localStorage/sessionStorage. */
(() => {
  'use strict';

  const VERSION = '0-A';
  const DB_NAME = 'wlp-cloud-shadow-v0';
  const DB_VERSION = 1;
  const MASTER_URL = './flashcards/wlp/wlp-flashcard-master.tsv';

  const KEYS = Object.freeze({
    drafts: 'wlp:local-additions:v1',
    overrides: 'wlp:local-overrides:v1',
    learningMetaV2: 'wlp:learning-meta:v2',
    learningMetaV1: 'wlp:learning-meta:v1',
    classification: 'wlp:classification-meta:v1',
    standardEvents: 'wlp:studyq-events:v1',
    standardSessions: 'wlp:studyq-sessions:v1',
    aiEvents: 'wlp:ai-study-events:v1',
    aiSessions: 'wlp:ai-study-session-history:v1',
    activityEvents: 'wlp:stage7:activity-events:v1',
    interactionEvents: 'wlp:stage7:interaction-events:v1',
    practiceEvents: 'wlp:stage7:practice-events:v1',
    quickReviewEvents: 'wlp:review-quick-events:v1',
    learnerProfile: 'wlp:ai-learner-profile:v1',
    learnerRoute: 'wlp:ai-route-state:v1',
    studyContexts: 'wlp:study-contexts:v1',
    studyBuilds: 'wlp:build-history:v1',
    links: 'wlp:links:v1'
  });

  const PORTABLE_PREF_KEYS = Object.freeze([
    'fc:cardMode',
    'wlp:stage7:study-options:v1',
    'wlp:study-hub-practice-mode:v1',
    'wlp:studyq:session-size-default:v1',
    'wlp:ai-study-session-size:v1',
    'wlp:ai-study-hint-limit:v1',
    'wlp:review-settings:v1',
    'wlp:stage7:progress-options:v1',
    'wlp:stage7:pinned-decks:v1',
    'wlp:studyq:deck-picker-mode:v1',
    'wlp:settings:general:v1'
  ]);

  const LOCAL_ONLY_KEYS = new Set([
    'fc:tts','fc:voiceName','wlp:ai-transport-mode:v1','wlp:stage7:recent-decks:v1',
    'wlp:stage7:activity-period:v1','wlp:stage7:progress-activity-source:v1','wlp:stage7:progress-learning-source:v1',
    'wlp:device-id:v1','wlp:authoring-merge-rollback:v1','wlp:classification-import-rollback:v1',
    'wlp:classification-meta:merge-rollback:v1','wlp:learning-meta:merge-rollback:v1','wlp:learning-sync-rollback:v1',
    'wlp:local-data-backup-meta:v1','wlp:local-data-restore-rollback:v1','wlp:ui-role:v2'
  ]);

  const SESSION_ONLY_KEYS = new Set([
    'wlp:session-admin:v1','wlp:learning-sync-rollback-session:v1','wlp:active-card-study-context:v1',
    'wlp:card-round-completion-session:v1','wlp:quick-review-auto-next-session:v1','wlp:review-quick-round-session:v1',
    'wlp:stage7:study-notice:v1','wlp:study-set-builder-state:v1','wlp:temporary-study-set:v1'
  ]);

  const SYNC_EXACT_KEYS = new Set([
    ...Object.values(KEYS),
    ...PORTABLE_PREF_KEYS
  ]);

  const state = { report: null };
  const $ = id => document.getElementById(id);
  const utf8Bytes = value => new TextEncoder().encode(String(value ?? '')).byteLength;

  function safeParse(raw, fallback = null) {
    if (raw == null || raw === '') return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function parseOrRaw(raw) {
    const parsed = safeParse(raw, undefined);
    return parsed === undefined ? String(raw ?? '') : parsed;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach(key => {
        if (value[key] !== undefined) out[key] = stableValue(value[key]);
      });
      return out;
    }
    return value;
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  async function sha256(value) {
    const data = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function parseTSV(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i], next = text[i + 1];
      if (ch === '"') {
        if (quoted && next === '"') { field += '"'; i += 1; }
        else quoted = !quoted;
      } else if (ch === '\t' && !quoted) {
        row.push(field); field = '';
      } else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && next === '\n') i += 1;
        row.push(field);
        if (row.some(v => String(v).length)) rows.push(row);
        row = []; field = '';
      } else field += ch;
    }
    row.push(field);
    if (row.some(v => String(v).length)) rows.push(row);
    if (!rows.length) return [];
    const headers = rows[0].map(v => String(v || '').trim());
    return rows.slice(1).filter(r => r.some(v => String(v).trim())).map(cols => {
      const obj = {};
      headers.forEach((header, index) => { obj[header] = String(cols[index] ?? ''); });
      return obj;
    });
  }

  async function loadMaster() {
    const response = await fetch(MASTER_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Master TSV request failed (${response.status}).`);
    const text = await response.text();
    return { rows: parseTSV(text), bytes: utf8Bytes(text), hash: await sha256(text) };
  }

  function readStorageMap(storage) {
    const out = {};
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key != null) out[key] = storage.getItem(key) ?? '';
    }
    return out;
  }

  function normalizeRecordMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    if (value.records && typeof value.records === 'object' && !Array.isArray(value.records)) return value.records;
    return value;
  }

  function asArray(value) { return Array.isArray(value) ? value : []; }

  async function addRecord(target, type, key, payload, options = {}) {
    const identity = String(key || '');
    if (!identity) throw new Error(`Missing identity for ${type}.`);
    const canonical = stableStringify(payload);
    const payloadHash = await sha256(canonical);
    const item = {
      entityType: type,
      entityKey: identity,
      payloadHash,
      tombstone: Boolean(options.tombstone),
      payloadBytes: utf8Bytes(canonical),
      source: options.source || ''
    };
    if (target.keySet.has(`${type}|${identity}`)) throw new Error(`Duplicate logical identity: ${type}|${identity}`);
    target.keySet.add(`${type}|${identity}`);
    target.records.push(item);
  }

  async function eventKey(stream, event, index) {
    const id = String(event?.eventId ?? event?.event_id ?? event?.id ?? '').trim();
    if (id) return `${stream}:${id}`;
    const fallbackHash = await sha256(stableStringify(event));
    return `${stream}:index:${index}:${fallbackHash.slice(0, 20)}`;
  }

  async function sessionKey(stream, session, index) {
    const id = String(session?.sessionId ?? session?.session_id ?? session?.id ?? '').trim();
    if (id) return `${stream}:${id}`;
    const fallbackHash = await sha256(stableStringify(session));
    return `${stream}:index:${index}:${fallbackHash.slice(0, 20)}`;
  }

  async function buildLogicalRecords(masterRows, local) {
    const target = { records: [], keySet: new Set(), warnings: [] };
    const drafts = asArray(safeParse(local[KEYS.drafts], []));
    const overrides = normalizeRecordMap(safeParse(local[KEYS.overrides], {}));

    for (const row of masterRows) {
      const wid = String(row.WordID ?? row['WordID'] ?? '').trim();
      if (!wid) { target.warnings.push('Master row without WordID was skipped.'); continue; }
      const cardKey = `wid:${wid}`;
      await addRecord(target, 'card', cardKey, {
        cardKey,
        wordId: wid,
        status: 'active',
        originKind: 'official',
        legacyBatch: row['Batch #'] ?? '',
        legacyGuidance: row['Guidance #'] ?? ''
      }, { source: 'master' });
      const override = overrides[wid] && typeof overrides[wid] === 'object' ? overrides[wid] : {};
      const content = {};
      ['Word','IPA','Part of Speech','Definition','Synonym(s)','Example Sentence','Note(s)','Category','Source'].forEach(field => {
        content[field] = Object.prototype.hasOwnProperty.call(override, field) ? override[field] : row[field];
      });
      await addRecord(target, 'card_content', cardKey, content, { source: Object.keys(override).length ? 'master+override' : 'master' });
    }

    for (const draft of drafts) {
      if (!draft || typeof draft !== 'object') continue;
      const localId = String(draft.localId || '').trim();
      if (!localId) { target.warnings.push('Draft without localId was skipped.'); continue; }
      const cardKey = `draft:${localId}`;
      await addRecord(target, 'card', cardKey, {
        cardKey,
        wordId: null,
        status: 'draft',
        originKind: 'personal',
        originRef: localId,
        createdAt: draft.createdAt || '',
        updatedAt: draft.updatedAt || ''
      }, { source: 'draft' });
      const content = {};
      ['Word','IPA','Part of Speech','Definition','Synonym(s)','Example Sentence','Note(s)','Category','Source'].forEach(field => {
        content[field] = draft[field] ?? '';
      });
      await addRecord(target, 'card_content', cardKey, content, { source: 'draft' });
    }

    const metaV2 = safeParse(local[KEYS.learningMetaV2], null);
    const metaRecords = metaV2 && Number(metaV2.schemaVersion) === 2 ? normalizeRecordMap(metaV2) : normalizeRecordMap(safeParse(local[KEYS.learningMetaV1], {}));
    for (const [key, value] of Object.entries(metaRecords)) {
      if (!/^(wid|draft):/.test(key) || !value || typeof value !== 'object') continue;
      await addRecord(target, 'card_learning_metadata', key, value, { tombstone: Boolean(value.deletedAt), source: 'learning-meta' });
    }

    const classRecords = normalizeRecordMap(safeParse(local[KEYS.classification], {}));
    for (const [key, value] of Object.entries(classRecords)) {
      if (!/^(wid|draft):/.test(key) || !value || typeof value !== 'object') continue;
      await addRecord(target, 'card_classification', key, value, { tombstone: Boolean(value.deletedAt), source: 'classification' });
    }

    const eventStreams = [
      ['standard', KEYS.standardEvents], ['ai', KEYS.aiEvents], ['activity', KEYS.activityEvents],
      ['interaction', KEYS.interactionEvents], ['practice', KEYS.practiceEvents], ['quick-review', KEYS.quickReviewEvents]
    ];
    for (const [stream, key] of eventStreams) {
      const items = asArray(safeParse(local[key], []));
      for (let i = 0; i < items.length; i += 1) {
        await addRecord(target, 'learning_event', await eventKey(stream, items[i], i), { sourceStream: stream, event: items[i] }, { source: key });
      }
    }

    const sessionStreams = [['standard', KEYS.standardSessions], ['ai', KEYS.aiSessions]];
    for (const [stream, key] of sessionStreams) {
      const items = asArray(safeParse(local[key], []));
      for (let i = 0; i < items.length; i += 1) {
        await addRecord(target, 'learning_session', await sessionKey(stream, items[i], i), { sourceStream: stream, session: items[i] }, { source: key });
      }
    }

    for (const [key, raw] of Object.entries(local)) {
      if (!key.startsWith('fc:wordid:')) continue;
      const wid = key.slice('fc:wordid:'.length);
      const value = safeParse(raw, null);
      if (!wid || !value || typeof value !== 'object') { target.warnings.push(`Malformed progress record: ${key}`); continue; }
      await addRecord(target, 'learning_state', `wid:${wid}`, value, { source: key });
    }

    const profile = safeParse(local[KEYS.learnerProfile], null);
    if (profile && typeof profile === 'object') await addRecord(target, 'learner_profile', 'account', profile, { source: KEYS.learnerProfile });
    const route = safeParse(local[KEYS.learnerRoute], null);
    if (route && typeof route === 'object') await addRecord(target, 'learner_route_state', 'account', route, { source: KEYS.learnerRoute });

    const contextsRaw = safeParse(local[KEYS.studyContexts], []);
    const contexts = Array.isArray(contextsRaw) ? contextsRaw : Object.values(normalizeRecordMap(contextsRaw));
    for (let i = 0; i < contexts.length; i += 1) {
      const context = contexts[i];
      if (!context || typeof context !== 'object') continue;
      const id = String(context.contextId || context.id || '').trim() || `index:${i}:${(await sha256(stableStringify(context))).slice(0, 20)}`;
      await addRecord(target, 'study_context', id, context, { source: KEYS.studyContexts });
    }

    const buildsRaw = safeParse(local[KEYS.studyBuilds], []);
    const builds = Array.isArray(buildsRaw) ? buildsRaw : Object.values(normalizeRecordMap(buildsRaw));
    for (let i = 0; i < builds.length; i += 1) {
      const build = builds[i];
      if (!build || typeof build !== 'object') continue;
      const id = String(build.buildId || build.id || '').trim() || `index:${i}:${(await sha256(stableStringify(build))).slice(0, 20)}`;
      await addRecord(target, 'study_build', id, build, { source: KEYS.studyBuilds });
    }

    if (local[KEYS.links] != null) await addRecord(target, 'user_links', 'account', parseOrRaw(local[KEYS.links]), { source: KEYS.links });
    for (const key of PORTABLE_PREF_KEYS) {
      if (local[key] == null) continue;
      await addRecord(target, 'user_preference', key, { key, value: parseOrRaw(local[key]) }, { source: key });
    }

    return target;
  }

  function classifyNamespaces(local, session) {
    const groups = {
      'Shadow sync candidate': { count: 0, bytes: 0, notes: 'Manifest-approved cloud candidates.' },
      'Device/local only': { count: 0, bytes: 0, notes: 'Kept local by design.' },
      'Session only': { count: 0, bytes: 0, notes: 'Temporary/session state; never cloud canonical.' },
      'Unexpected / unmapped': { count: 0, bytes: 0, notes: 'Requires inspection before Shadow transport.' }
    };

    const classify = (key, raw, isSession) => {
      const bytes = utf8Bytes(key) + utf8Bytes(raw);
      if (isSession || SESSION_ONLY_KEYS.has(key)) { groups['Session only'].count += 1; groups['Session only'].bytes += bytes; return; }
      if (key.startsWith('fc:wordid:') || SYNC_EXACT_KEYS.has(key)) { groups['Shadow sync candidate'].count += 1; groups['Shadow sync candidate'].bytes += bytes; return; }
      if (LOCAL_ONLY_KEYS.has(key)) { groups['Device/local only'].count += 1; groups['Device/local only'].bytes += bytes; return; }
      if (key.startsWith('wlp:') || key.startsWith('fc:')) { groups['Unexpected / unmapped'].count += 1; groups['Unexpected / unmapped'].bytes += bytes; }
    };

    Object.entries(local).forEach(([key, raw]) => classify(key, raw, false));
    Object.entries(session).forEach(([key, raw]) => classify(key, raw, true));
    return groups;
  }

  function findUnexpectedNamespaces(local) {
    return Object.keys(local).filter(key => {
      if (!(key.startsWith('wlp:') || key.startsWith('fc:'))) return false;
      if (key.startsWith('fc:wordid:')) return false;
      return !SYNC_EXACT_KEYS.has(key) && !LOCAL_ONLY_KEYS.has(key) && !SESSION_ONLY_KEYS.has(key);
    }).sort();
  }

  function summarizeEntities(records) {
    const map = new Map();
    records.forEach(record => {
      const current = map.get(record.entityType) || { count: 0, bytes: 0 };
      current.count += 1; current.bytes += record.payloadBytes;
      map.set(record.entityType, current);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([entityType, value]) => ({ entityType, ...value }));
  }

  async function computeSnapshotHash(records) {
    const tuples = records
      .map(r => `${r.entityType}|${r.entityKey}|${r.payloadHash}|${r.tombstone ? 1 : 0}`)
      .sort();
    return sha256(tuples.join('\n'));
  }

  function openShadowDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('record_hashes')) db.createObjectStore('record_hashes', { keyPath: 'recordKey' });
        if (!db.objectStoreNames.contains('pending_mutations')) db.createObjectStore('pending_mutations', { keyPath: 'mutationId' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open Shadow IndexedDB.'));
    });
  }

  async function readMeta(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readonly');
      const request = tx.objectStore('meta').get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function writeMeta(db, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save Shadow scan metadata.'));
    });
  }

  function renderAudit(groups) {
    const body = $('audit-body');
    body.innerHTML = '';
    Object.entries(groups).forEach(([name, value]) => {
      const tr = document.createElement('tr');
      [name, String(value.count), value.bytes.toLocaleString(), value.notes].forEach(text => {
        const td = document.createElement('td'); td.textContent = text; tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function renderEntities(items) {
    const body = $('entity-body');
    body.innerHTML = '';
    items.forEach(item => {
      const tr = document.createElement('tr');
      const identity = item.entityType === 'card' || item.entityType.startsWith('card_') || item.entityType === 'learning_state'
        ? 'WID / Draft key' : 'Stable source ID / deterministic fallback';
      [item.entityType, String(item.count), item.bytes.toLocaleString(), identity].forEach(text => {
        const td = document.createElement('td'); td.textContent = text; tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function renderErrors(errors) {
    const panel = $('errors-panel'), list = $('error-list');
    list.innerHTML = '';
    if (!errors.length) { panel.classList.add('hidden'); return; }
    errors.forEach(error => { const li = document.createElement('li'); li.textContent = error; list.appendChild(li); });
    panel.classList.remove('hidden');
  }

  function formatTime(value) {
    try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
    catch { return String(value || ''); }
  }

  async function runScan() {
    const button = $('run-scan');
    button.disabled = true;
    $('export-report').disabled = true;
    $('scan-status').className = 'status-line';
    $('scan-status').textContent = 'Reading current WLP data and computing SHA-256 hashes…';

    const errors = [];
    try {
      const config = window.WLPCloudShadowConfig || {};
      if (config.cloudEnabled || config.allowCloudReads || config.allowCloudWrites) {
        throw new Error('Safety stop: v0-A requires Cloud OFF and both cloud permissions disabled.');
      }

      const local = readStorageMap(localStorage);
      const session = readStorageMap(sessionStorage);
      const master = await loadMaster();
      const logical = await buildLogicalRecords(master.rows, local);
      errors.push(...logical.warnings);
      const unexpected = findUnexpectedNamespaces(local);
      unexpected.forEach(key => errors.push(`Unexpected persisted WLP namespace: ${key}`));

      const snapshotHash = await computeSnapshotHash(logical.records);
      const entitySummary = summarizeEntities(logical.records);
      const namespaceAudit = classifyNamespaces(local, session);
      const drafts = asArray(safeParse(local[KEYS.drafts], [])).filter(v => v && typeof v === 'object').length;

      const db = await openShadowDB();
      const previous = await readMeta(db, 'last_local_scan');
      const scannedAt = new Date().toISOString();
      await writeMeta(db, {
        key: 'last_local_scan',
        phase: VERSION,
        manifestVersion: Number(config.manifestVersion || 1),
        scannedAt,
        snapshotHash,
        logicalRecordCount: logical.records.length,
        masterCardCount: master.rows.length,
        draftCount: drafts,
        errorCount: errors.length
      });
      db.close();

      state.report = {
        format: 'WLP_CLOUD_SHADOW_LOCAL_SCAN',
        version: 1,
        phase: VERSION,
        scannedAt,
        cloud: { enabled: false, reads: false, writes: false },
        master: { url: MASTER_URL, cardCount: master.rows.length, bytes: master.bytes, sha256: master.hash },
        summary: { masterCards: master.rows.length, drafts, logicalRecords: logical.records.length, errors: errors.length },
        snapshotHash,
        previousScan: previous ? { scannedAt: previous.scannedAt, snapshotHash: previous.snapshotHash, sameSnapshot: previous.snapshotHash === snapshotHash } : null,
        namespaceAudit,
        entitySummary,
        unexpectedNamespaces: unexpected,
        warnings: logical.warnings,
        records: logical.records
      };

      $('metric-master').textContent = String(master.rows.length);
      $('metric-drafts').textContent = String(drafts);
      $('metric-records').textContent = String(logical.records.length);
      $('metric-errors').textContent = String(errors.length);
      $('snapshot-hash').textContent = snapshotHash;
      $('previous-scan').textContent = previous
        ? `Previous scan: ${formatTime(previous.scannedAt)} · ${previous.snapshotHash === snapshotHash ? 'snapshot unchanged' : 'snapshot changed'}`
        : 'No previous Shadow scan is stored on this device.';
      renderAudit(namespaceAudit);
      renderEntities(entitySummary);
      renderErrors(errors);
      ['summary-panel','hash-panel','audit-panel','entity-panel'].forEach(id => $(id).classList.remove('hidden'));
      $('export-report').disabled = false;
      $('scan-status').className = `status-line ${errors.length ? 'error' : 'success'}`;
      $('scan-status').textContent = errors.length
        ? `Scan complete with ${errors.length} item${errors.length === 1 ? '' : 's'} requiring inspection. Cloud remains OFF.`
        : `Scan complete · ${logical.records.length.toLocaleString()} logical records · Cloud remains OFF.`;
    } catch (error) {
      console.error('WLP Shadow local scan failed:', error);
      $('scan-status').className = 'status-line error';
      $('scan-status').textContent = error?.message || String(error);
      renderErrors([error?.message || String(error)]);
    } finally {
      button.disabled = false;
    }
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = state.report.scannedAt.replace(/[:.]/g, '-');
    a.href = url;
    a.download = `wlp-cloud-shadow-local-scan-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function init() {
    const config = window.WLPCloudShadowConfig || {};
    $('cloud-state').textContent = config.cloudEnabled ? 'ON' : 'OFF';
    $('run-scan').addEventListener('click', runScan);
    $('export-report').addEventListener('click', exportReport);
    window.WLPCloudShadow = Object.freeze({ version: VERSION, runScan });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
