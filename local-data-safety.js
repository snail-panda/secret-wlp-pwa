(() => {
  'use strict';

  const DRAFTS_KEY = 'wlp:local-additions:v1';
  const OVERRIDES_KEY = 'wlp:local-overrides:v1';
  const BACKUP_META_KEY = 'wlp:local-data-backup-meta:v1';
  const ROLE_KEY = 'wlp:ui-role:v2';
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

    return { drafts, overrides };
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
      changedRecordCount(meta.editorState.overrides, current.overrides);
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
    if (key === BACKUP_META_KEY || key === ROLE_KEY) return false;
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
    return {
      drafts: drafts.length,
      localEdits: Object.values(overrides).filter(value => value && typeof value === 'object' && !Array.isArray(value)).length,
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
        node.textContent = 'No Draft / Local Edit changes since backup';
        node.dataset.state = 'safe';
      } else {
        node.textContent = `${changes} Draft / Local Edit change${changes === 1 ? '' : 's'} since backup`;
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
    setInlineStatus(`Backup prepared for download · ${backup.summary.drafts} Drafts · ${backup.summary.localEdits} Local Edits · Progress included.`, 'success');

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

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-local-backup-now]');
    if (!button) return;
    event.preventDefault();
    backUpNow(button);
  });

  window.addEventListener('storage', event => {
    if (!event.key || event.key === DRAFTS_KEY || event.key === OVERRIDES_KEY || event.key.startsWith(PROGRESS_PREFIX) || event.key === ACTIVITY_KEY || event.key === PRACTICE_KEY || event.key === BACKUP_META_KEY) {
      render();
    }
  });
  window.addEventListener('pageshow', render);
  window.addEventListener('focus', render);

  render();
  window.WLPLocalDataSafety = { render, buildBackup };
})();
