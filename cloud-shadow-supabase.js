/* WLP Supabase Shadow Mode v0-B — MANUAL shadow upload + compare-only transport.
   Safety: no automatic sync and no cloud -> WLP write-back. */
(() => {
  'use strict';

  const DB_NAME = 'wlp-cloud-shadow-v0';
  const DB_VERSION = 1;
  const CONFIG_META_KEY = 'supabase_config';
  const SESSION_META_KEY = 'supabase_session';
  const DEVICE_META_KEY = 'shadow_device';
  const LAST_UPLOAD_META_KEY = 'last_cloud_upload';
  const LAST_COMPARE_META_KEY = 'last_cloud_compare';
  const HASH_SCOPE_META_KEY = 'record_hash_scope';
  const LEGACY_DEVICE_KEY = 'wlp:device-id:v1';
  const MAX_CONFIG_URL = 300;

  const state = {
    config: null,
    session: null,
    device: null,
    compareReport: null,
    busy: false
  };

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function safeText(value) { return String(value ?? '').trim(); }
  function normalizeProjectUrl(value) {
    const raw = safeText(value).replace(/\/+$/, '');
    if (!raw) return '';
    let url;
    try { url = new URL(raw); } catch { throw new Error('Project URL is not a valid URL.'); }
    if (url.protocol !== 'https:') throw new Error('Project URL must use https://');
    if (url.href.length > MAX_CONFIG_URL) throw new Error('Project URL is unexpectedly long.');
    return url.href.replace(/\/$/, '');
  }

  function validatePublishableKey(value) {
    const key = safeText(value);
    if (!key) return '';
    if (!key.startsWith('sb_publishable_')) throw new Error('Use a Supabase publishable key (sb_publishable_…).');
    return key;
  }

  function openDB() {
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

  async function getMeta(key) {
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction('meta', 'readonly').objectStore('meta').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  }

  async function putMeta(value) {
    const db = await openDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put(value);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not save Shadow metadata.'));
      });
    } finally { db.close(); }
  }

  async function deleteMeta(key) {
    const db = await openDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not clear Shadow metadata.'));
      });
    } finally { db.close(); }
  }

  async function readAllHashes() {
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction('record_hashes', 'readonly').objectStore('record_hashes').getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  }

  async function replaceHashes(records, scopeKey) {
    const db = await openDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('record_hashes', 'readwrite');
        const store = tx.objectStore('record_hashes');
        store.clear();
        records.forEach(record => store.put({
          recordKey: `${record.entityType}|${record.entityKey}`,
          entityType: record.entityType,
          entityKey: record.entityKey,
          payloadHash: record.payloadHash,
          tombstone: Boolean(record.tombstone),
          updatedAt: new Date().toISOString()
        }));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not save uploaded Shadow hashes.'));
      });
    } finally { db.close(); }
    await putMeta({ key: HASH_SCOPE_META_KEY, scopeKey, updatedAt: new Date().toISOString() });
  }

  function detectPlatform() {
    const ua = navigator.userAgent || '';
    if (/iPhone/i.test(ua) && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) return 'iPhone Safari';
    if (/iPhone/i.test(ua) && /CriOS/i.test(ua)) return 'iPhone Chrome';
    if (/Windows/i.test(ua) && /Chrome/i.test(ua)) return 'Windows Chrome';
    if (/Macintosh/i.test(ua) && /Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'Mac Safari';
    return navigator.platform || 'Browser';
  }

  async function getDevice() {
    if (state.device) return state.device;
    const saved = await getMeta(DEVICE_META_KEY);
    const legacy = safeText(localStorage.getItem(LEGACY_DEVICE_KEY));
    const deviceKey = legacy || safeText(saved?.deviceKey) || crypto.randomUUID();
    const label = safeText(saved?.label) || detectPlatform();
    state.device = { deviceKey, label, platform: detectPlatform() };
    await putMeta({ key: DEVICE_META_KEY, ...state.device });
    return state.device;
  }

  async function saveDeviceLabel(label) {
    const device = await getDevice();
    state.device = { ...device, label: safeText(label) || device.platform };
    await putMeta({ key: DEVICE_META_KEY, ...state.device });
    renderDevice();
  }

  async function loadConfig() {
    const base = window.WLPCloudShadowConfig || {};
    const saved = await getMeta(CONFIG_META_KEY);
    state.config = {
      url: safeText(saved?.url || base.supabaseUrl),
      publishableKey: safeText(saved?.publishableKey || base.publishableKey)
    };
    return state.config;
  }

  async function saveConfig() {
    const url = normalizeProjectUrl($('supabase-url').value);
    const publishableKey = validatePublishableKey($('supabase-key').value);
    if (!url || !publishableKey) throw new Error('Project URL and publishable key are both required.');
    const changedProject = Boolean(state.config && (state.config.url !== url || state.config.publishableKey !== publishableKey));
    state.config = { url, publishableKey };
    await putMeta({ key: CONFIG_META_KEY, ...state.config, savedAt: new Date().toISOString() });
    if (changedProject && state.session) {
      state.session = null;
      await deleteMeta(SESSION_META_KEY);
      renderAuth();
    }
    setCloudStatus('CONFIGURED');
    setCloudMessage('Supabase configuration saved in isolated Shadow IndexedDB.', 'success');
    refreshButtons();
  }

  async function loadSession() {
    const saved = await getMeta(SESSION_META_KEY);
    state.session = saved?.accessToken && saved?.refreshToken && saved?.userId ? saved : null;
    return state.session;
  }

  async function saveSession(data) {
    const expiresIn = Math.max(60, Number(data.expires_in || 3600));
    state.session = {
      key: SESSION_META_KEY,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: data.user?.id || state.session?.userId || '',
      email: data.user?.email || state.session?.email || '',
      expiresAt: Date.now() + expiresIn * 1000,
      savedAt: new Date().toISOString()
    };
    if (!state.session.userId) throw new Error('Supabase Auth did not return a user ID.');
    await putMeta(state.session);
    renderAuth();
    refreshButtons();
    return state.session;
  }

  async function authRequest(path, body, token = '') {
    const config = state.config || await loadConfig();
    if (!config.url || !config.publishableKey) throw new Error('Save the Supabase Project URL and publishable key first.');
    const headers = { 'Content-Type': 'application/json', apikey: config.publishableKey };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${config.url}${path}`, { method: 'POST', headers, body: body == null ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || data?.error || `Supabase Auth request failed (${response.status}).`);
    return data;
  }

  async function signIn() {
    const email = safeText($('supabase-email').value);
    const password = $('supabase-password').value;
    if (!email || !password) throw new Error('Email and password are required.');
    const data = await authRequest('/auth/v1/token?grant_type=password', { email, password });
    $('supabase-password').value = '';
    await saveSession(data);
    setCloudStatus('READY');
    setCloudMessage(`Signed in as ${state.session.email || email}. Shadow transport is manual only.`, 'success');
  }

  async function refreshSession() {
    if (!state.session?.refreshToken) throw new Error('No saved Supabase session. Sign in again.');
    const data = await authRequest('/auth/v1/token?grant_type=refresh_token', { refresh_token: state.session.refreshToken });
    return saveSession(data);
  }

  async function ensureSession() {
    if (!state.session) await loadSession();
    if (!state.session) throw new Error('Sign in to Supabase first.');
    if (Number(state.session.expiresAt || 0) <= Date.now() + 60000) await refreshSession();
    return state.session;
  }

  async function signOut() {
    if (state.session?.accessToken && state.config?.url && state.config?.publishableKey) {
      try { await authRequest('/auth/v1/logout', null, state.session.accessToken); } catch (error) { console.warn('Shadow sign-out request failed; local session will still be cleared.', error); }
    }
    state.session = null;
    await deleteMeta(SESSION_META_KEY);
    renderAuth();
    setCloudStatus(state.config?.url ? 'CONFIGURED' : 'OFF');
    setCloudMessage('Shadow Supabase session cleared on this browser.', '');
    refreshButtons();
  }

  async function rest(path, options = {}) {
    const config = state.config || await loadConfig();
    const session = await ensureSession();
    const headers = { apikey: config.publishableKey, Authorization: `Bearer ${session.accessToken}`, ...(options.headers || {}) };
    if (options.body != null) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${config.url}/rest/v1/${path}`, { method: options.method || 'GET', headers, body: options.body == null ? undefined : JSON.stringify(options.body) });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new Error(data?.message || data?.details || data?.hint || `Supabase Data API request failed (${response.status}).`);
    return { data, response };
  }

  async function registerDevice() {
    const session = await ensureSession();
    const device = await getDevice();
    const now = new Date().toISOString();
    await rest('wlp_devices?on_conflict=owner_id,device_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: [{
        owner_id: session.userId,
        device_key: device.deviceKey,
        label: device.label,
        platform: device.platform,
        app_version: '1.8.6.192-shadow-v0B',
        last_seen_at: now
      }]
    });
    return device;
  }

  function extractUpdatedAt(payload) {
    const candidates = [payload?.updatedAt, payload?.updated_at, payload?.event?.updatedAt, payload?.session?.updatedAt];
    for (const value of candidates) {
      if (!value) continue;
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return null;
  }

  function extractRevision(payload) {
    const candidates = [payload?.revision, payload?.row_version, payload?.version];
    for (const value of candidates) {
      const n = Number(value);
      if (Number.isInteger(n) && n >= 0) return n;
    }
    return null;
  }

  function deriveCardKey(record) {
    if (/^(wid|draft):/.test(record.entityKey)) return record.entityKey;
    const payload = record.payload || {};
    const wid = payload?.wordId ?? payload?.word_id ?? payload?.event?.wordId ?? payload?.session?.wordId;
    if (wid != null && String(wid).trim()) return `wid:${String(wid).trim()}`;
    return null;
  }

  async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function getDelta(records, scopeKey) {
    const scope = await getMeta(HASH_SCOPE_META_KEY);
    const previous = scope?.scopeKey === scopeKey ? await readAllHashes() : [];
    const previousMap = new Map(previous.map(item => [item.recordKey, item]));
    const currentMap = new Map(records.map(record => [`${record.entityType}|${record.entityKey}`, record]));
    const changed = [];
    for (const [recordKey, record] of currentMap) {
      const old = previousMap.get(recordKey);
      if (!old || old.payloadHash !== record.payloadHash || Boolean(old.tombstone) !== Boolean(record.tombstone)) changed.push(record);
    }
    const tombstones = [];
    if (previous.length) {
      for (const [recordKey, old] of previousMap) {
        if (currentMap.has(recordKey)) continue;
        const tombstoneHash = await sha256(`WLP_SHADOW_TOMBSTONE|${recordKey}`);
        tombstones.push({
          entityType: old.entityType,
          entityKey: old.entityKey,
          payloadHash: tombstoneHash,
          tombstone: true,
          payload: null,
          source: 'shadow-observed-removal'
        });
      }
    }
    return { changed, tombstones, priorCount: previous.length };
  }

  function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }

  async function createRun(report, device) {
    const session = await ensureSession();
    const { data } = await rest('wlp_shadow_runs?select=run_id', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: [{
        owner_id: session.userId,
        device_key: device.deviceKey,
        manifest_version: `WLP_MIGRATION_MANIFEST_V${report.version}`,
        shadow_schema_version: 1,
        app_version: '1.8.6.192-shadow-v0B',
        status: 'started',
        local_record_count: report.summary.logicalRecords,
        uploaded_record_count: 0,
        local_snapshot_hash: report.snapshotHash,
        diagnostics: { phase: report.phase, master_sha256: report.master.sha256, scan_errors: report.summary.errors }
      }]
    });
    const runId = Array.isArray(data) ? data[0]?.run_id : data?.run_id;
    if (!runId) throw new Error('Supabase did not return a Shadow run ID.');
    return runId;
  }

  async function updateRun(runId, values) {
    await rest(`wlp_shadow_runs?run_id=eq.${encodeURIComponent(runId)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: values
    });
  }

  async function uploadShadow() {
    const snapshot = window.WLPCloudShadow?.getLatestSnapshot?.();
    if (!snapshot) throw new Error('Run Local Scan first.');
    if (snapshot.report.summary.errors !== 0 || snapshot.report.unexpectedNamespaces.length !== 0) throw new Error('Shadow upload blocked: the local scan has errors or unmapped namespaces.');
    if ((window.WLPCloudShadowConfig || {}).writeBackToWLP) throw new Error('Safety stop: writeBackToWLP must remain false in v0-B.');

    setBusy(true);
    setCloudStatus('UPLOADING');
    setCloudMessage('Preparing manual Shadow delta…', '');
    let runId = '';
    try {
      const device = await registerDevice();
      const session = await ensureSession();
      const scopeKey = `${state.config.url}|${session.userId}|${device.deviceKey}`;
      const delta = await getDelta(snapshot.records, scopeKey);
      const outgoing = [...delta.changed, ...delta.tombstones];
      runId = await createRun(snapshot.report, device);
      const batchSize = Math.max(50, Math.min(500, Number((window.WLPCloudShadowConfig || {}).uploadBatchSize || 300)));
      const batches = chunk(outgoing, batchSize);
      let uploaded = 0;

      for (let i = 0; i < batches.length; i += 1) {
        const now = new Date().toISOString();
        const rows = batches[i].map(record => ({
          owner_id: session.userId,
          device_key: device.deviceKey,
          entity_type: record.entityType,
          entity_key: record.entityKey,
          card_key: deriveCardKey(record),
          source_namespace: record.source || null,
          payload: record.tombstone ? null : record.payload,
          payload_hash: record.payloadHash,
          source_revision: extractRevision(record.payload),
          source_updated_at: extractUpdatedAt(record.payload),
          tombstone: Boolean(record.tombstone),
          observed_at: now,
          run_id: runId
        }));
        await rest('wlp_shadow_records?on_conflict=owner_id,device_key,entity_type,entity_key', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: rows
        });
        uploaded += rows.length;
        setCloudMessage(`Uploading Shadow records… ${uploaded.toLocaleString()} / ${outgoing.length.toLocaleString()}`, '');
        if (i && i % 10 === 0) await sleep(0);
      }

      await updateRun(runId, {
        status: 'uploaded',
        completed_at: new Date().toISOString(),
        uploaded_record_count: outgoing.length,
        diagnostics: {
          phase: snapshot.report.phase,
          master_sha256: snapshot.report.master.sha256,
          scan_errors: 0,
          previous_uploaded_hash_count: delta.priorCount,
          changed_records: delta.changed.length,
          tombstones: delta.tombstones.length
        }
      });
      await replaceHashes(snapshot.records, scopeKey);
      await putMeta({ key: LAST_UPLOAD_META_KEY, runId, uploadedAt: new Date().toISOString(), snapshotHash: snapshot.report.snapshotHash, uploadedRecords: outgoing.length });
      setCloudStatus('SHADOWED');
      setCloudMessage(`Shadow upload complete · ${outgoing.length.toLocaleString()} changed/new records · no WLP data was modified.`, 'success');
      $('compare-cloud').disabled = false;
    } catch (error) {
      if (runId) {
        try { await updateRun(runId, { status: 'failed', completed_at: new Date().toISOString(), error_text: error?.message || String(error) }); } catch {}
      }
      setCloudStatus('ERROR');
      throw error;
    } finally { setBusy(false); }
  }

  async function fetchPaged(table, select, extra = '') {
    const pageSize = Math.max(100, Math.min(1000, Number((window.WLPCloudShadowConfig || {}).fetchPageSize || 1000)));
    const out = [];
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const suffix = extra ? `&${extra}` : '';
      const { data, response } = await rest(`${table}?select=${encodeURIComponent(select)}${suffix}`, { headers: { Range: `${from}-${to}`, Prefer: 'count=exact' } });
      const rows = Array.isArray(data) ? data : [];
      out.push(...rows);
      if (rows.length < pageSize) break;
      const range = response.headers.get('content-range') || '';
      const total = Number(range.split('/')[1]);
      if (Number.isFinite(total) && out.length >= total) break;
    }
    return out;
  }

  function compareAgainst(localRecords, remoteRows) {
    const local = new Map(localRecords.map(r => [`${r.entityType}|${r.entityKey}`, r]));
    const remote = new Map(remoteRows.map(r => [`${r.entity_type}|${r.entity_key}`, r]));
    let same = 0, different = 0, localOnly = 0, remoteOnly = 0, alignedTombstones = 0;
    for (const [key, record] of local) {
      const other = remote.get(key);
      if (!other) { localOnly += 1; continue; }
      if (!other.tombstone && other.payload_hash === record.payloadHash && Boolean(record.tombstone) === false) same += 1;
      else different += 1;
    }
    for (const [key, other] of remote) {
      if (local.has(key)) continue;
      if (other.tombstone) alignedTombstones += 1;
      else remoteOnly += 1;
    }
    return { same, different, localOnly, remoteOnly, alignedTombstones, remoteRows: remoteRows.length };
  }

  async function compareCloud() {
    const snapshot = window.WLPCloudShadow?.getLatestSnapshot?.();
    if (!snapshot) throw new Error('Run Local Scan first.');
    setBusy(true);
    setCloudStatus('COMPARING');
    setCloudMessage('Reading Shadow hashes only. Nothing will be written back into WLP…', '');
    try {
      const device = await getDevice();
      const devices = await fetchPaged('wlp_devices', 'device_key,label,platform,last_seen_at', 'order=registered_at.asc');
      const rows = await fetchPaged('wlp_shadow_records', 'device_key,entity_type,entity_key,payload_hash,tombstone', 'order=device_key.asc');
      const groups = new Map();
      rows.forEach(row => {
        if (!groups.has(row.device_key)) groups.set(row.device_key, []);
        groups.get(row.device_key).push(row);
      });
      const labels = new Map(devices.map(item => [item.device_key, item.label || item.platform || item.device_key]));
      const comparisons = [...groups.entries()].map(([deviceKey, remoteRows]) => ({
        deviceKey,
        label: labels.get(deviceKey) || deviceKey,
        currentDevice: deviceKey === device.deviceKey,
        ...compareAgainst(snapshot.records, remoteRows)
      }));
      const { data: cursorRows } = await rest('wlp_shadow_changes?select=change_seq&order=change_seq.desc&limit=1');
      const latestChangeSeq = Array.isArray(cursorRows) && cursorRows[0] ? Number(cursorRows[0].change_seq || 0) : 0;
      const current = comparisons.find(item => item.currentDevice);
      const selfMirrorPass = Boolean(current && current.different === 0 && current.localOnly === 0 && current.remoteOnly === 0);
      state.compareReport = {
        format: 'WLP_CLOUD_SHADOW_COMPARE',
        version: 1,
        phase: '0-B',
        comparedAt: new Date().toISOString(),
        localSnapshotHash: snapshot.report.snapshotHash,
        currentDeviceKey: device.deviceKey,
        latestChangeSeq,
        selfMirrorPass,
        comparisons
      };
      await putMeta({ key: LAST_COMPARE_META_KEY, ...state.compareReport });
      renderCompare(state.compareReport);
      $('export-compare').disabled = false;
      setCloudStatus(selfMirrorPass ? 'VERIFIED' : 'CHECK');
      setCloudMessage(selfMirrorPass
        ? `Compare complete · this device's Cloud mirror matches the current local snapshot · cursor ${latestChangeSeq.toLocaleString()}.`
        : 'Compare complete, but this device mirror is not an exact match. Inspect the comparison table before proceeding.', selfMirrorPass ? 'success' : 'error');
    } finally { setBusy(false); }
  }

  function renderCompare(report) {
    const body = $('compare-body');
    body.innerHTML = '';
    report.comparisons.forEach(item => {
      const tr = document.createElement('tr');
      const name = `${item.label}${item.currentDevice ? ' · this browser' : ''}`;
      [name, item.same, item.different, item.localOnly, item.remoteOnly, item.alignedTombstones].forEach(value => {
        const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    $('compare-cursor').textContent = String(report.latestChangeSeq || 0);
    $('compare-result').textContent = report.selfMirrorPass ? 'PASS' : 'CHECK';
    $('compare-result').className = report.selfMirrorPass ? 'compare-pass' : 'compare-check';
    $('compare-panel').classList.remove('hidden');
  }

  function exportCompare() {
    if (!state.compareReport) return;
    const blob = new Blob([JSON.stringify(state.compareReport, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-cloud-shadow-compare-${state.compareReport.comparedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setCloudStatus(value) {
    window.WLPCloudShadow?.setCloudState?.(value);
  }

  function setCloudMessage(message, kind) {
    const el = $('cloud-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }

  function setBusy(value) { state.busy = Boolean(value); refreshButtons(); }

  function refreshButtons() {
    const configured = Boolean(state.config?.url && state.config?.publishableKey);
    const signedIn = Boolean(state.session?.accessToken && state.session?.userId);
    const snapshot = window.WLPCloudShadow?.getLatestSnapshot?.();
    const scanned = Boolean(snapshot);
    const scanClean = Boolean(snapshot && snapshot.report?.summary?.errors === 0 && (snapshot.report?.unexpectedNamespaces || []).length === 0);
    $('save-cloud-config').disabled = state.busy;
    $('sign-in-cloud').disabled = state.busy || !configured;
    $('sign-out-cloud').disabled = state.busy || !signedIn;
    $('upload-shadow').disabled = state.busy || !configured || !signedIn || !scanned || !scanClean;
    $('compare-cloud').disabled = state.busy || !configured || !signedIn || !scanned || !scanClean;
  }

  function renderConfig() {
    $('supabase-url').value = state.config?.url || '';
    $('supabase-key').value = state.config?.publishableKey || '';
  }

  function renderAuth() {
    const el = $('auth-state');
    if (state.session?.userId) {
      el.textContent = `Signed in · ${state.session.email || state.session.userId}`;
      el.className = 'auth-state signed';
    } else {
      el.textContent = 'Not signed in';
      el.className = 'auth-state';
    }
  }

  function renderDevice() {
    if (!state.device) return;
    $('device-label').value = state.device.label || '';
    $('device-key').textContent = state.device.deviceKey;
  }

  async function handle(fn) {
    try { await fn(); }
    catch (error) {
      console.error('WLP Shadow Supabase:', error);
      setCloudMessage(error?.message || String(error), 'error');
      if (state.busy) setBusy(false);
    }
  }

  async function init() {
    await loadConfig();
    await loadSession();
    await getDevice();
    renderConfig(); renderAuth(); renderDevice();
    setCloudStatus(state.session ? 'READY' : (state.config?.url ? 'CONFIGURED' : 'OFF'));
    setCloudMessage('No cloud action runs automatically. Configure and sign in, then use the manual buttons.', '');

    $('save-cloud-config').addEventListener('click', () => handle(saveConfig));
    $('sign-in-cloud').addEventListener('click', () => handle(signIn));
    $('sign-out-cloud').addEventListener('click', () => handle(signOut));
    $('save-device-label').addEventListener('click', () => handle(() => saveDeviceLabel($('device-label').value)));
    $('upload-shadow').addEventListener('click', () => handle(uploadShadow));
    $('compare-cloud').addEventListener('click', () => handle(compareCloud));
    $('export-compare').addEventListener('click', exportCompare);
    window.addEventListener('wlp-cloud-shadow-scan-complete', refreshButtons);
    refreshButtons();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
