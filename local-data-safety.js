/* WLP Stage 7 v1.8.6.151 — Exact lightweight Authoring change counts. */
(() => {
  'use strict';

  const DRAFTS_KEY = 'wlp:local-additions:v1';
  const OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const LEARNING_META_KEY = 'wlp:learning-meta:v2';
  const LEGACY_LEARNING_META_KEY = 'wlp:learning-meta:v1';
  const CLASSIFICATION_KEY = 'wlp:classification-meta:v1';
  const CLASSIFICATION_MERGE_ROLLBACK_KEY = 'wlp:classification-meta:merge-rollback:v1';
  const LEARNING_SYNC_ROLLBACK_KEY = 'wlp:learning-sync-rollback:v1';
  const DEVICE_ID_KEY = 'wlp:device-id:v1';
  const METADATA_MERGE_ROLLBACK_KEY = 'wlp:learning-meta:merge-rollback:v1';
  const BACKUP_META_KEY = 'wlp:local-data-backup-meta:v1';
  const RESTORE_ROLLBACK_KEY = 'wlp:local-data-restore-rollback:v1';
  const ROLE_KEY = 'wlp:ui-role:v2';
  const SESSION_ADMIN_KEY = 'wlp:session-admin:v1';
  const PROGRESS_PREFIX = 'fc:wordid:';
  const ACTIVITY_KEY = 'wlp:stage7:activity-events:v1';
  const PRACTICE_KEY = 'wlp:stage7:practice-events:v1';
  const BACKUP_FORMAT = 'WLP_LOCAL_DATA_BACKUP';
  const BACKUP_VERSION = 1;

  const DRAFT_FIELDS = [
    'Word','IPA','Part of Speech','Definition','Synonym(s)',
    'Example Sentence','Note(s)','Category','Source'
  ];

  function parseJson(raw, fallback) {
    try {
      const value = JSON.parse(raw || '');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function setBackupMetaValue(payload) {
    const nextValue = JSON.stringify(payload);
    const previous = localStorage.getItem(BACKUP_META_KEY);
    try {
      localStorage.setItem(BACKUP_META_KEY, nextValue);
      return true;
    } catch (error) {
      if (previous == null) throw error;
      localStorage.removeItem(BACKUP_META_KEY);
      try {
        localStorage.setItem(BACKUP_META_KEY, nextValue);
        return true;
      } catch (retryError) {
        try { localStorage.setItem(BACKUP_META_KEY, previous); } catch (_) {}
        throw retryError;
      }
    }
  }

  function readDrafts() {
    const value = parseJson(localStorage.getItem(DRAFTS_KEY), []);
    return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  }

  function readOverrides() {
    const value = parseJson(localStorage.getItem(OVERRIDES_KEY), {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function readLearningMeta() {
    const value = parseJson(localStorage.getItem(LEARNING_META_KEY), null);
    if (value && typeof value === 'object' && !Array.isArray(value) && Number(value.schemaVersion) === 2 && value.records && typeof value.records === 'object' && !Array.isArray(value.records)) {
      return value.records;
    }
    const legacy = parseJson(localStorage.getItem(LEGACY_LEARNING_META_KEY), {});
    return legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy : {};
  }

  function readClassificationMeta() {
    const value = parseJson(localStorage.getItem(CLASSIFICATION_KEY), {});
    const records = value && typeof value === 'object' && !Array.isArray(value) && value.records && typeof value.records === 'object' && !Array.isArray(value.records)
      ? value.records
      : (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    const out = {};
    Object.entries(records).forEach(([key, record]) => {
      if (!/^(?:wid|draft):/.test(key) || !record || typeof record !== 'object' || Array.isArray(record)) return;
      const active = ['entryTypes','usageTags','topicTags','discoveryTags'].some(field => Array.isArray(record[field]) && record[field].length);
      if (active) out[key] = record;
    });
    return out;
  }

  function learningMetaContent(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.deletedAt) return null;
    const content = value.content && typeof value.content === 'object' && !Array.isArray(value.content) ? value.content : value;
    const sense = String(content.senseHook ?? '').trim();
    const memory = String(content.memoryHook ?? '').trim();
    const entryType = String(content.entryType ?? '').trim();
    const situations = Array.isArray(content.situations) ? content.situations : [];
    const alternatives = Array.isArray(content.alternativeExpressions) ? content.alternativeExpressions : [];
    if (!sense && !memory && !entryType && !situations.length && !alternatives.length) return null;
    return content;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((out, key) => {
        out[key] = stableValue(value[key]);
        return out;
      }, {});
    }
    return value;
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  function hashTextParts(parts) {
    let h1 = 2166136261 >>> 0;
    let h2 = 2246822519 >>> 0;
    let length = 0;
    const feed = text => {
      const value = String(text ?? '');
      length += value.length;
      for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);
        h1 ^= code;
        h1 = Math.imul(h1, 16777619) >>> 0;
        h2 ^= code + ((i & 255) << 8);
        h2 = Math.imul(h2, 3266489917) >>> 0;
      }
    };
    parts.forEach(part => { feed(part); feed('\u001f'); });
    return `${length}:${h1.toString(36)}:${h2.toString(36)}`;
  }

  function digestPairs(pairs) {
    const normalized = (Array.isArray(pairs) ? pairs : [])
      .map(([key, value]) => [String(key ?? ''), String(value ?? '')])
      .sort((a, b) => a[0].localeCompare(b[0]));
    const parts = [];
    normalized.forEach(([key, value]) => {
      parts.push(key, value);
    });
    return { count: normalized.length, digest: hashTextParts(parts) };
  }

  function recordFingerprint(value) {
    const text = String(value ?? '');
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36);
  }

  function fingerprintPairs(pairs) {
    const normalized = (Array.isArray(pairs) ? pairs : [])
      .map(([key, value]) => [String(key ?? ''), String(value ?? '')]);
    const digest = digestPairs(normalized);
    const wid = [];
    const numeric = [];
    const generic = [];
    normalized.forEach(([key, value]) => {
      const fp = recordFingerprint(value);
      const widMatch = key.match(/^wid:(\d+)$/);
      if (widMatch) { wid.push([Number(widMatch[1]), fp]); return; }
      if (/^\d+$/.test(key)) { numeric.push([Number(key), fp]); return; }
      generic.push([key, fp]);
    });
    wid.sort((a, b) => a[0] - b[0]);
    numeric.sort((a, b) => a[0] - b[0]);
    generic.sort((a, b) => a[0].localeCompare(b[0]));
    const lines = [];
    let previous = 0;
    wid.forEach(([id, fp]) => { lines.push(`w${(id - previous).toString(36)}:${fp}`); previous = id; });
    previous = 0;
    numeric.forEach(([id, fp]) => { lines.push(`n${(id - previous).toString(36)}:${fp}`); previous = id; });
    generic.forEach(([key, fp]) => lines.push(`k${encodeURIComponent(key)}:${fp}`));
    return { ...digest, records:lines.join('\n') };
  }

  function digestOnlyState(state) {
    if (!state || typeof state !== 'object') return null;
    const pick = value => ({ count:Number(value?.count || 0), digest:String(value?.digest || '') });
    return {
      format: 'digest-v1',
      drafts: pick(state.drafts),
      overrides: pick(state.overrides),
      learningHooks: pick(state.learningHooks),
      classification: pick(state.classification)
    };
  }

  function currentEditorFingerprintState() {
    const drafts = [];
    readDrafts().forEach((draft, index) => {
      const id = String(draft.localId || `draft-${index}-${draft.Word || ''}`);
      const content = {};
      DRAFT_FIELDS.forEach(field => { content[field] = String(draft[field] ?? ''); });
      drafts.push([id, stableStringify(content)]);
    });

    const overrides = [];
    Object.entries(readOverrides()).forEach(([wordId, edit]) => {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return;
      const content = {};
      DRAFT_FIELDS.forEach(field => { content[field] = String(edit[field] ?? ''); });
      overrides.push([String(wordId), stableStringify(content)]);
    });

    const learningHooks = [];
    Object.entries(readLearningMeta()).forEach(([key, value]) => {
      if (!learningMetaContent(value)) return;
      learningHooks.push([String(key), stableStringify(value)]);
    });

    const classification = [];
    Object.entries(readClassificationMeta()).forEach(([key, value]) => {
      classification.push([String(key), stableStringify(value)]);
    });

    return {
      format: 'fingerprints-v1',
      drafts: fingerprintPairs(drafts),
      overrides: fingerprintPairs(overrides),
      learningHooks: fingerprintPairs(learningHooks),
      classification: fingerprintPairs(classification)
    };
  }

  function fingerprintsFromLegacyEditorState(editorState) {
    if (!editorState || typeof editorState !== 'object' || Array.isArray(editorState)) return null;
    const fingerprintMap = value => fingerprintPairs(Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {}));
    return {
      format: 'fingerprints-v1',
      drafts: fingerprintMap(editorState.drafts),
      overrides: fingerprintMap(editorState.overrides),
      learningHooks: fingerprintMap(editorState.learningHooks),
      classification: fingerprintMap(editorState.classification)
    };
  }

  function digestLegacyEditorState(editorState) {
    return digestOnlyState(fingerprintsFromLegacyEditorState(editorState));
  }

  function fingerprintMap(block) {
    const out = new Map();
    const raw = String(block?.records || '');
    if (!raw) return out;
    let previousWid = 0;
    let previousNumeric = 0;
    raw.split('\n').forEach(line => {
      const split = line.indexOf(':');
      if (split < 2) return;
      const kind = line[0];
      const encoded = line.slice(1, split);
      const fingerprint = line.slice(split + 1);
      if (!fingerprint) return;
      if (kind === 'w') {
        const delta = parseInt(encoded, 36);
        if (!Number.isFinite(delta)) return;
        previousWid += delta;
        out.set(`wid:${previousWid}`, fingerprint);
        return;
      }
      if (kind === 'n') {
        const delta = parseInt(encoded, 36);
        if (!Number.isFinite(delta)) return;
        previousNumeric += delta;
        out.set(String(previousNumeric), fingerprint);
        return;
      }
      if (kind === 'k') {
        try { out.set(decodeURIComponent(encoded), fingerprint); } catch (_) {}
      }
    });
    return out;
  }

  function changedFingerprintCount(beforeBlock, afterBlock) {
    const before = fingerprintMap(beforeBlock);
    const after = fingerprintMap(afterBlock);
    const ids = new Set([...before.keys(), ...after.keys()]);
    let changed = 0;
    ids.forEach(id => { if (before.get(id) !== after.get(id)) changed += 1; });
    return changed;
  }

  function compareEditorState(meta, currentState) {
    if (!meta || !currentState) return null;
    const defs = [
      ['drafts', 'Drafts'],
      ['overrides', 'Local Edits'],
      ['learningHooks', 'Learning Metadata'],
      ['classification', 'Classification']
    ];

    const exactBaseline = meta.editorStateFingerprints?.format === 'fingerprints-v1'
      ? meta.editorStateFingerprints
      : fingerprintsFromLegacyEditorState(meta.editorState);
    if (exactBaseline) {
      const details = defs.map(([key, label]) => ({ key, label, count:changedFingerprintCount(exactBaseline[key], currentState[key]) }));
      return { exact:true, total:details.reduce((sum, item) => sum + item.count, 0), details };
    }

    const baseline = meta.editorStateDigest?.format === 'digest-v1' ? meta.editorStateDigest : digestLegacyEditorState(meta.editorState);
    if (!baseline) return null;
    const details = defs.map(([key, label]) => {
      const before = baseline[key] || {};
      const after = currentState[key] || {};
      const changed = Number(before.count || 0) !== Number(after.count || 0) || String(before.digest || '') !== String(after.digest || '');
      return { key, label, changed };
    });
    return { exact:false, details };
  }

  function compactBackupMetaValue(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
    if (meta.editorStateFingerprints?.format === 'fingerprints-v1' && !meta.editorState) {
      if (Number(meta.metaVersion) >= 3 && meta.editorStateDigest?.format === 'digest-v1') return meta;
      return { ...meta, metaVersion:3, editorStateDigest:digestOnlyState(meta.editorStateFingerprints) };
    }
    if (meta.editorState) {
      const fingerprints = fingerprintsFromLegacyEditorState(meta.editorState);
      if (!fingerprints) return meta;
      const next = { ...meta, metaVersion:3, editorStateDigest:digestOnlyState(fingerprints), editorStateFingerprints:fingerprints };
      delete next.editorState;
      return next;
    }
    if (meta.editorStateDigest?.format === 'digest-v1') return meta;
    return meta;
  }

  function compactBackupMeta() {
    const raw = parseJson(localStorage.getItem(BACKUP_META_KEY), null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const compact = compactBackupMetaValue(raw);
    if (compact !== raw) {
      try { setBackupMetaValue(compact); } catch (_) {}
    }
    return compact;
  }

  function readMeta() {
    return compactBackupMeta();
  }

  function backupMetaPayload({ lastBackupAt, fileName, summary: backupSummary, restoredAt = '' }) {
    const fingerprints = currentEditorFingerprintState();
    const payload = {
      metaVersion: 3,
      lastBackupAt,
      fileName,
      editorStateDigest: digestOnlyState(fingerprints),
      editorStateFingerprints: fingerprints,
      summary: backupSummary
    };
    if (restoredAt) payload.restoredAt = restoredAt;
    return payload;
  }

  function countProgressRecords() {
    let count = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PROGRESS_PREFIX)) count += 1;
    }
    return count;
  }

  function eventCount(key) {
    const value = parseJson(localStorage.getItem(key), []);
    return Array.isArray(value) ? value.length : 0;
  }

  function isBackupKey(key) {
    if (!key) return false;
    if (key === BACKUP_META_KEY || key === ROLE_KEY || key === SESSION_ADMIN_KEY || key === RESTORE_ROLLBACK_KEY || key === DEVICE_ID_KEY || key === METADATA_MERGE_ROLLBACK_KEY || key === CLASSIFICATION_MERGE_ROLLBACK_KEY || key === LEARNING_SYNC_ROLLBACK_KEY) return false;
    return key.startsWith('wlp:') || key.startsWith(PROGRESS_PREFIX);
  }

  function collectStorage() {
    const storage = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!isBackupKey(key)) continue;
      storage[key] = localStorage.getItem(key);
    }
    return storage;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function fileStamp(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Unknown';
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
      }).format(date);
    } catch {
      return date.toLocaleString();
    }
  }

  function summary() {
    const drafts = readDrafts();
    const overrides = readOverrides();
    const learningHooks = Object.values(readLearningMeta()).filter(value => Boolean(learningMetaContent(value))).length;
    const classificationRecords = Object.keys(readClassificationMeta()).length;
    return {
      drafts: drafts.length,
      localEdits: Object.values(overrides).filter(value => value && typeof value === 'object' && !Array.isArray(value)).length,
      learningHooks,
      classificationRecords,
      progressRecords: countProgressRecords(),
      activityEvents: eventCount(ACTIVITY_KEY),
      practiceEvents: eventCount(PRACTICE_KEY)
    };
  }

  function buildBackup() {
    const exportedAt = new Date().toISOString();
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt,
      origin: location.origin,
      summary: summary(),
      storage: collectStorage()
    };
  }

  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setInlineStatus(text, tone = '') {
    document.querySelectorAll('[data-safety-action-status]').forEach(node => {
      node.textContent = text;
      node.dataset.tone = tone;
      node.hidden = false;
    });
  }

  function render() {
    const data = summary();
    const state = currentEditorFingerprintState();
    const meta = readMeta();
    const comparison = compareEditorState(meta, state);

    document.querySelectorAll('[data-safety-drafts]').forEach(node => { node.textContent = String(data.drafts); });
    document.querySelectorAll('[data-safety-edits]').forEach(node => { node.textContent = String(data.localEdits); });
    document.querySelectorAll('[data-safety-progress]').forEach(node => { node.textContent = String(data.progressRecords); });
    document.querySelectorAll('[data-safety-classification]').forEach(node => { node.textContent = String(data.classificationRecords); });

    document.querySelectorAll('[data-safety-last-backup]').forEach(node => {
      node.textContent = meta?.lastBackupAt ? formatDate(meta.lastBackupAt) : 'Never';
    });

    document.querySelectorAll('[data-safety-change-count]').forEach(node => {
      if (comparison === null) {
        node.textContent = 'Not backed up yet';
        node.dataset.state = 'warning';
        return;
      }

      if (comparison.exact) {
        const changed = comparison.details.filter(item => item.count > 0);
        if (!comparison.total) {
          node.textContent = 'No Authoring changes since backup';
          node.dataset.state = 'safe';
        } else if (changed.length === 1) {
          const item = changed[0];
          node.textContent = `${item.count} ${item.label} change${item.count === 1 ? '' : 's'} since backup`;
          node.dataset.state = comparison.total >= 10 ? 'urgent' : 'warning';
        } else {
          const detail = changed.map(item => `${item.label} ${item.count}`).join(' · ');
          node.textContent = `${comparison.total} Authoring change${comparison.total === 1 ? '' : 's'} since backup · ${detail}`;
          node.dataset.state = comparison.total >= 10 ? 'urgent' : 'warning';
        }
        return;
      }

      const changed = comparison.details.filter(item => item.changed);
      if (!changed.length) {
        node.textContent = 'No Authoring changes since backup';
        node.dataset.state = 'safe';
      } else if (changed.length === 1) {
        node.textContent = `${changed[0].label} changed since backup · exact count after next backup`;
        node.dataset.state = 'warning';
      } else {
        node.textContent = `Authoring content changed since backup · ${changed.map(item => item.label).join(', ')} · exact count after next backup`;
        node.dataset.state = 'warning';
      }
    });

    document.querySelectorAll('[data-local-safety]').forEach(panel => {
      if (comparison === null) panel.dataset.backupState = 'never';
      else if (comparison.exact) panel.dataset.backupState = comparison.total === 0 ? 'safe' : comparison.total >= 10 ? 'urgent' : 'changed';
      else panel.dataset.backupState = comparison.details.some(item => item.changed) ? 'changed' : 'safe';
    });
  }

  function backUpNow(button) {
    const backup = buildBackup();
    const now = new Date(backup.exportedAt);
    const filename = `wlp-local-data-backup-${fileStamp(now)}.json`;

    downloadJson(backup, filename);

    let markerSaved = true;
    try {
      setBackupMetaValue(backupMetaPayload({
        lastBackupAt: backup.exportedAt,
        fileName: filename,
        summary: backup.summary
      }));
    } catch (error) {
      markerSaved = false;
      console.warn('Backup file downloaded, but the local backup marker could not be saved:', error);
    }

    render();
    setInlineStatus(
      markerSaved
        ? `Backup ready: ${filename} · ${backup.summary.drafts} Drafts · ${backup.summary.localEdits} Local Edits · ${backup.summary.learningHooks || 0} Learning Metadata · ${backup.summary.classificationRecords || 0} Classification · Progress included. If you cannot remember where it was saved, search this filename in Files.`
        : `Backup file downloaded: ${filename}. The file is valid, but WLP could not update the local Last Backup marker because browser storage is full.`,
      markerSaved ? 'success' : 'warning'
    );

    if (button) {
      const old = button.textContent;
      button.textContent = 'Backup Ready ✓';
      button.disabled = true;
      setTimeout(() => {
        button.textContent = old;
        button.disabled = false;
      }, 1400);
    }
  }


  function setRestoreStatus(text, tone = '') {
    const node = document.getElementById('local-restore-status');
    if (!node) return;
    node.textContent = text;
    node.hidden = false;
    node.classList.toggle('is-error', tone === 'error');
  }

  function clearRestoreStatus() {
    const node = document.getElementById('local-restore-status');
    if (!node) return;
    node.hidden = true;
    node.textContent = '';
    node.classList.remove('is-error');
  }

  function normalizeBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('This file is not a valid WLP Local Data Backup.');
    }
    if (data.format !== BACKUP_FORMAT) {
      throw new Error('This is not a WLP Local Data Backup file.');
    }
    if (Number(data.version) !== BACKUP_VERSION) {
      throw new Error(`Unsupported backup version: ${data.version ?? 'unknown'}.`);
    }
    if (!data.storage || typeof data.storage !== 'object' || Array.isArray(data.storage)) {
      throw new Error('The backup does not contain valid local-storage data.');
    }

    const storage = {};
    Object.entries(data.storage).forEach(([key, value]) => {
      if (!isBackupKey(key)) return;
      if (typeof value !== 'string') {
        throw new Error(`Invalid value for ${key}.`);
      }
      storage[key] = value;
    });

    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
      origin: typeof data.origin === 'string' ? data.origin : '',
      summary: data.summary && typeof data.summary === 'object' ? data.summary : {},
      storage
    };
  }

  function summaryFromStorage(storage) {
    const drafts = parseJson(storage[DRAFTS_KEY], []);
    const overrides = parseJson(storage[OVERRIDES_KEY], {});
    const activity = parseJson(storage[ACTIVITY_KEY], []);
    const practice = parseJson(storage[PRACTICE_KEY], []);
    const learningMetaV2 = parseJson(storage[LEARNING_META_KEY], null);
    const learningMetaLegacy = parseJson(storage[LEGACY_LEARNING_META_KEY], {});
    const learningRecords = learningMetaV2 && typeof learningMetaV2 === 'object' && !Array.isArray(learningMetaV2) && Number(learningMetaV2.schemaVersion) === 2 && learningMetaV2.records && typeof learningMetaV2.records === 'object'
      ? learningMetaV2.records
      : (learningMetaLegacy && typeof learningMetaLegacy === 'object' && !Array.isArray(learningMetaLegacy) ? learningMetaLegacy : {});
    const classificationValue = parseJson(storage[CLASSIFICATION_KEY], {});
    const classificationRecordsRaw = classificationValue && typeof classificationValue === 'object' && !Array.isArray(classificationValue) && classificationValue.records && typeof classificationValue.records === 'object'
      ? classificationValue.records
      : (classificationValue && typeof classificationValue === 'object' && !Array.isArray(classificationValue) ? classificationValue : {});
    const classificationRecords = Object.entries(classificationRecordsRaw).filter(([key, record]) =>
      /^(?:wid|draft):/.test(key) && record && typeof record === 'object' && !Array.isArray(record) &&
      ['entryTypes','usageTags','topicTags','discoveryTags'].some(field => Array.isArray(record[field]) && record[field].length)
    ).length;
    let progressRecords = 0;
    Object.keys(storage).forEach(key => { if (key.startsWith(PROGRESS_PREFIX)) progressRecords += 1; });
    return {
      drafts: Array.isArray(drafts) ? drafts.filter(item => item && typeof item === 'object').length : 0,
      localEdits: overrides && typeof overrides === 'object' && !Array.isArray(overrides)
        ? Object.values(overrides).filter(value => value && typeof value === 'object' && !Array.isArray(value)).length
        : 0,
      learningHooks: Object.values(learningRecords).filter(value => Boolean(learningMetaContent(value))).length,
      classificationRecords,
      progressRecords,
      activityEvents: Array.isArray(activity) ? activity.length : 0,
      practiceEvents: Array.isArray(practice) ? practice.length : 0
    };
  }

  function writeManagedSnapshot(backup) {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (isBackupKey(key)) keysToRemove.push(key);
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    Object.entries(backup.storage).forEach(([key, value]) => localStorage.setItem(key, value));
  }

  function restoreManagedStorage(backup, sourceFileName = '') {
    const currentBackup = buildBackup();
    localStorage.setItem(RESTORE_ROLLBACK_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      source: 'before-restore',
      backup: currentBackup
    }));

    try {
      writeManagedSnapshot(backup);
      // A full snapshot restore replaces the metadata state, so an older
      // metadata-merge rollback would no longer describe the active branch.
      localStorage.removeItem(METADATA_MERGE_ROLLBACK_KEY);
      localStorage.removeItem(CLASSIFICATION_MERGE_ROLLBACK_KEY);
      localStorage.removeItem(LEARNING_SYNC_ROLLBACK_KEY);
    } catch (error) {
      try { writeManagedSnapshot(currentBackup); } catch {}
      throw new Error(`Restore could not be completed safely: ${error?.message || 'storage write failed'}`);
    }

    const restoredSummary = summaryFromStorage(backup.storage);
    const restoredAt = backup.exportedAt || new Date().toISOString();
    setBackupMetaValue(backupMetaPayload({
      lastBackupAt: restoredAt,
      fileName: sourceFileName || 'restored-local-data-backup.json',
      summary: restoredSummary,
      restoredAt: new Date().toISOString()
    }));
    return restoredSummary;
  }

  function readRollback() {
    const value = parseJson(localStorage.getItem(RESTORE_ROLLBACK_KEY), null);
    if (!value || typeof value !== 'object' || !value.backup) return null;
    try {
      return { ...value, backup: normalizeBackup(value.backup) };
    } catch {
      return null;
    }
  }

  function applyRollback() {
    const rollback = readRollback();
    if (!rollback) throw new Error('No valid rollback copy is available.');
    const backup = rollback.backup;

    writeManagedSnapshot(backup);
    localStorage.removeItem(LEARNING_SYNC_ROLLBACK_KEY);

    const restoredSummary = summaryFromStorage(backup.storage);
    setBackupMetaValue(backupMetaPayload({
      lastBackupAt: backup.exportedAt || new Date().toISOString(),
      fileName: 'rollback-before-restore',
      summary: restoredSummary,
      restoredAt: new Date().toISOString()
    }));
    localStorage.removeItem(RESTORE_ROLLBACK_KEY);
    return restoredSummary;
  }

  function installRestore() {
    const fileInput = document.getElementById('local-restore-file');
    const choose = document.getElementById('local-restore-choose');
    const preview = document.getElementById('local-restore-preview');
    if (!fileInput || !choose || !preview) return;

    const fileName = document.getElementById('local-restore-file-name');
    const dateNode = document.getElementById('local-restore-date');
    const originNode = document.getElementById('local-restore-origin');
    const draftsNode = document.getElementById('local-restore-drafts');
    const editsNode = document.getElementById('local-restore-edits');
    const progressNode = document.getElementById('local-restore-progress');
    const activityNode = document.getElementById('local-restore-activity');
    const classificationNode = document.getElementById('local-restore-classification');
    const warningNode = document.getElementById('local-restore-warning');
    const clear = document.getElementById('local-restore-clear');
    const chooseAnother = document.getElementById('local-restore-choose-another');
    const start = document.getElementById('local-restore-start');
    const confirmBox = document.getElementById('local-restore-confirm');
    const cancel = document.getElementById('local-restore-cancel');
    const confirmButton = document.getElementById('local-restore-confirm-button');
    const undoWrap = document.getElementById('local-restore-undo');
    const undoButton = document.getElementById('local-restore-undo-button');

    let selectedBackup = null;
    let selectedFileName = '';

    function renderUndo() {
      if (undoWrap) undoWrap.hidden = !readRollback();
    }

    function resetSelection() {
      selectedBackup = null;
      selectedFileName = '';
      fileInput.value = '';
      preview.hidden = true;
      if (confirmBox) confirmBox.hidden = true;
      clearRestoreStatus();
    }

    function showPreview(backup, name) {
      selectedBackup = backup;
      selectedFileName = name;
      const counts = summaryFromStorage(backup.storage);
      fileName.textContent = name || 'Selected backup';
      dateNode.textContent = backup.exportedAt ? formatDate(backup.exportedAt) : 'Unknown';
      originNode.textContent = backup.origin || 'Unknown';
      draftsNode.textContent = String(counts.drafts);
      editsNode.textContent = String(counts.localEdits);
      progressNode.textContent = String(counts.progressRecords);
      activityNode.textContent = String(counts.activityEvents);
      if (classificationNode) classificationNode.textContent = String(counts.classificationRecords);
      const crossOrigin = backup.origin && backup.origin !== location.origin;
      warningNode.textContent = crossOrigin
        ? `This backup was created on ${backup.origin}. It can still be restored here. Current browser-local WLP data covered by the backup will be replaced, and one rollback copy will be kept locally.`
        : 'Restore replaces the browser-local WLP data covered by this backup. A rollback copy of the current state will be kept on this device before anything is replaced.';
      preview.hidden = false;
      if (confirmBox) confirmBox.hidden = true;
      clearRestoreStatus();
    }

    choose.addEventListener('click', () => fileInput.click());
    chooseAnother?.addEventListener('click', () => fileInput.click());
    clear?.addEventListener('click', resetSelection);

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        showPreview(normalizeBackup(parsed), file.name);
      } catch (error) {
        resetSelection();
        setRestoreStatus(error?.message || 'Could not read this backup file.', 'error');
      }
    });

    start?.addEventListener('click', () => {
      if (!selectedBackup) return;
      if (confirmBox) confirmBox.hidden = false;
      confirmBox?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    cancel?.addEventListener('click', () => { if (confirmBox) confirmBox.hidden = true; });

    confirmButton?.addEventListener('click', () => {
      if (!selectedBackup) return;
      try {
        const restored = restoreManagedStorage(selectedBackup, selectedFileName);
        setRestoreStatus(`Restore complete · ${restored.drafts} Drafts · ${restored.localEdits} Local Edits · ${restored.classificationRecords || 0} Classification · ${restored.progressRecords} Progress cards. Reloading…`);
        if (confirmBox) confirmBox.hidden = true;
        render();
        renderUndo();
        setTimeout(() => location.reload(), 700);
      } catch (error) {
        setRestoreStatus(error?.message || 'Restore failed. No changes were applied.', 'error');
      }
    });

    undoButton?.addEventListener('click', () => {
      if (!readRollback()) return;
      const firstLabel = undoButton.textContent;
      if (undoButton.dataset.confirm !== 'yes') {
        undoButton.dataset.confirm = 'yes';
        undoButton.textContent = 'Confirm Undo Restore';
        setTimeout(() => {
          if (undoButton.dataset.confirm === 'yes') {
            delete undoButton.dataset.confirm;
            undoButton.textContent = firstLabel;
          }
        }, 5000);
        return;
      }
      try {
        const restored = applyRollback();
        delete undoButton.dataset.confirm;
        setRestoreStatus(`Previous local state restored · ${restored.drafts} Drafts · ${restored.localEdits} Local Edits · ${restored.classificationRecords || 0} Classification · ${restored.progressRecords} Progress cards. Reloading…`);
        setTimeout(() => location.reload(), 700);
      } catch (error) {
        setRestoreStatus(error?.message || 'Could not undo the restore.', 'error');
      }
    });

    renderUndo();
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-local-backup-now]');
    if (!button) return;
    event.preventDefault();
    backUpNow(button);
  });

  window.addEventListener('storage', event => {
    if (!event.key || event.key === DRAFTS_KEY || event.key === OVERRIDES_KEY || event.key === LEARNING_META_KEY || event.key === LEGACY_LEARNING_META_KEY || event.key === CLASSIFICATION_KEY || event.key.startsWith(PROGRESS_PREFIX) || event.key === ACTIVITY_KEY || event.key === PRACTICE_KEY || event.key === BACKUP_META_KEY) {
      render();
    }
  });
  window.addEventListener('wlp-classification-metadata-changed', render);
  window.addEventListener('pageshow', render);
  window.addEventListener('focus', render);

  compactBackupMeta();
  render();
  installRestore();
  window.WLPLocalDataSafety = { render, buildBackup, compactBackupMeta };
})();
