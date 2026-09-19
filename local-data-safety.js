(() => {
  'use strict';

  const DRAFTS_KEY = 'wlp:local-additions:v1';
  const OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const LEARNING_META_KEY = 'wlp:learning-meta:v2';
  const LEGACY_LEARNING_META_KEY = 'wlp:learning-meta:v1';
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

  function currentEditorState() {
    const drafts = {};
    readDrafts().forEach((draft, index) => {
      const id = String(draft.localId || `draft-${index}-${draft.Word || ''}`);
      const content = {};
      DRAFT_FIELDS.forEach(field => { content[field] = String(draft[field] ?? ''); });
      drafts[id] = stableStringify(content);
    });

    const overrides = {};
    Object.entries(readOverrides()).forEach(([wordId, edit]) => {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return;
      const content = {};
      DRAFT_FIELDS.forEach(field => { content[field] = String(edit[field] ?? ''); });
      overrides[String(wordId)] = stableStringify(content);
    });

    const learningHooks = {};
    Object.entries(readLearningMeta()).forEach(([key, value]) => {
      if (!learningMetaContent(value)) return;
      learningHooks[String(key)] = stableStringify(value);
    });

    return { drafts, overrides, learningHooks };
  }

  function changedRecordCount(before, after) {
    const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    let changed = 0;
    ids.forEach(id => {
      if ((before || {})[id] !== (after || {})[id]) changed += 1;
    });
    return changed;
  }

  function changesSinceBackup(meta, current) {
    if (!meta?.editorState) return null;
    return changedRecordCount(meta.editorState.drafts, current.drafts) +
      changedRecordCount(meta.editorState.overrides, current.overrides) +
      changedRecordCount(meta.editorState.learningHooks || {}, current.learningHooks || {});
  }

  function readMeta() {
    const value = parseJson(localStorage.getItem(BACKUP_META_KEY), null);
    return value && typeof value === 'object' ? value : null;
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
    if (key === BACKUP_META_KEY || key === ROLE_KEY || key === SESSION_ADMIN_KEY || key === RESTORE_ROLLBACK_KEY || key === DEVICE_ID_KEY || key === METADATA_MERGE_ROLLBACK_KEY) return false;
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
    return {
      drafts: drafts.length,
      localEdits: Object.values(overrides).filter(value => value && typeof value === 'object' && !Array.isArray(value)).length,
      learningHooks,
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
    const state = currentEditorState();
    const meta = readMeta();
    const changes = changesSinceBackup(meta, state);

    document.querySelectorAll('[data-safety-drafts]').forEach(node => { node.textContent = String(data.drafts); });
    document.querySelectorAll('[data-safety-edits]').forEach(node => { node.textContent = String(data.localEdits); });
    document.querySelectorAll('[data-safety-progress]').forEach(node => { node.textContent = String(data.progressRecords); });

    document.querySelectorAll('[data-safety-last-backup]').forEach(node => {
      node.textContent = meta?.lastBackupAt ? formatDate(meta.lastBackupAt) : 'Never';
    });

    document.querySelectorAll('[data-safety-change-count]').forEach(node => {
      if (changes === null) {
        node.textContent = 'Not backed up yet';
        node.dataset.state = 'warning';
      } else if (changes === 0) {
        node.textContent = 'No Draft / Local Edit / Metadata changes since backup';
        node.dataset.state = 'safe';
      } else {
        node.textContent = `${changes} local content change${changes === 1 ? '' : 's'} since backup`;
        node.dataset.state = changes >= 10 ? 'urgent' : 'warning';
      }
    });

    document.querySelectorAll('[data-local-safety]').forEach(panel => {
      panel.dataset.backupState = changes === null ? 'never' : changes === 0 ? 'safe' : changes >= 10 ? 'urgent' : 'changed';
    });
  }

  function backUpNow(button) {
    const backup = buildBackup();
    const now = new Date(backup.exportedAt);
    const filename = `wlp-local-data-backup-${fileStamp(now)}.json`;

    downloadJson(backup, filename);

    const editorState = currentEditorState();
    localStorage.setItem(BACKUP_META_KEY, JSON.stringify({
      lastBackupAt: backup.exportedAt,
      fileName: filename,
      editorState,
      summary: backup.summary
    }));

    render();
    setInlineStatus(`Backup ready: ${filename} · ${backup.summary.drafts} Drafts · ${backup.summary.localEdits} Local Edits · ${backup.summary.learningHooks || 0} Learning Metadata · Progress included. If you cannot remember where it was saved, search this filename in Files.`, 'success');

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
    let progressRecords = 0;
    Object.keys(storage).forEach(key => { if (key.startsWith(PROGRESS_PREFIX)) progressRecords += 1; });
    return {
      drafts: Array.isArray(drafts) ? drafts.filter(item => item && typeof item === 'object').length : 0,
      localEdits: overrides && typeof overrides === 'object' && !Array.isArray(overrides)
        ? Object.values(overrides).filter(value => value && typeof value === 'object' && !Array.isArray(value)).length
        : 0,
      learningHooks: Object.values(learningRecords).filter(value => Boolean(learningMetaContent(value))).length,
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
    } catch (error) {
      try { writeManagedSnapshot(currentBackup); } catch {}
      throw new Error(`Restore could not be completed safely: ${error?.message || 'storage write failed'}`);
    }

    const restoredSummary = summaryFromStorage(backup.storage);
    const restoredAt = backup.exportedAt || new Date().toISOString();
    const editorState = currentEditorState();
    localStorage.setItem(BACKUP_META_KEY, JSON.stringify({
      lastBackupAt: restoredAt,
      fileName: sourceFileName || 'restored-local-data-backup.json',
      editorState,
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

    const restoredSummary = summaryFromStorage(backup.storage);
    localStorage.setItem(BACKUP_META_KEY, JSON.stringify({
      lastBackupAt: backup.exportedAt || new Date().toISOString(),
      fileName: 'rollback-before-restore',
      editorState: currentEditorState(),
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
        setRestoreStatus(`Restore complete · ${restored.drafts} Drafts · ${restored.localEdits} Local Edits · ${restored.progressRecords} Progress cards. Reloading…`);
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
        setRestoreStatus(`Previous local state restored · ${restored.drafts} Drafts · ${restored.localEdits} Local Edits · ${restored.progressRecords} Progress cards. Reloading…`);
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
    if (!event.key || event.key === DRAFTS_KEY || event.key === OVERRIDES_KEY || event.key === LEARNING_META_KEY || event.key === LEGACY_LEARNING_META_KEY || event.key.startsWith(PROGRESS_PREFIX) || event.key === ACTIVITY_KEY || event.key === PRACTICE_KEY || event.key === BACKUP_META_KEY) {
      render();
    }
  });
  window.addEventListener('pageshow', render);
  window.addEventListener('focus', render);

  render();
  installRestore();
  window.WLPLocalDataSafety = { render, buildBackup };
})();
