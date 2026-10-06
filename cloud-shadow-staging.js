(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const STAGE_SCHEMA_VERSION = 1;
  const APP_VERSION = '1.8.6.196-canonical-stage-v1';
  const CORE_LIBRARY_TABLES = new Set(['cards', 'card_content', 'card_classification']);
  const UNION_HISTORY_TABLES = new Set([
    'learning_sessions', 'learning_events', 'study_contexts', 'study_context_cards',
    'study_builds', 'study_build_cards'
  ]);
  const state = { busy: false, report: null, lastStageKey: '', lastFullHash: '' };

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

  function stableStringify(value) { return JSON.stringify(stableValue(value)); }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(String(value ?? ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function tablePrimaryKey(table, row) {
    const keys = {
      cards: item => item.card_id,
      card_content: item => item.card_id,
      card_learning_metadata: item => item.card_id,
      learning_situations: item => item.situation_id,
      learning_alternatives: item => item.alternative_id,
      learning_alternative_situations: item => item.link_id || `${item.alternative_id}|${item.situation_id}`,
      card_classification: item => item.card_id,
      learning_sessions: item => item.session_id,
      learning_events: item => item.event_id,
      learning_state: item => item.card_id,
      learner_profile: () => 'account',
      learner_route_state: () => 'account',
      study_contexts: item => item.context_id,
      study_context_cards: item => `${item.context_id}|${item.ordinal}`,
      study_builds: item => item.build_id,
      study_build_cards: item => `${item.build_id}|${item.ordinal}`,
      user_link_categories: item => item.category_id,
      user_links: item => item.link_id,
      user_preferences: item => item.section
    };
    return String(keys[table]?.(row) || '');
  }

  function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }

  function sleep(ms = 0) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function supabaseApi() {
    const api = window.WLPCloudShadowSupabase;
    if (!api?.rest || !api?.ensureSession || !api?.registerDevice || !api?.fetchPaged) {
      throw new Error('Shadow Supabase transport is not ready. Reload this diagnostics page.');
    }
    return api;
  }

  async function buildLocalCanonical() {
    const snapshot = window.WLPCloudShadow?.getLatestSnapshot?.();
    if (!snapshot || !Array.isArray(snapshot.records)) throw new Error('Run Local Scan first.');
    if (snapshot.report?.summary?.errors !== 0 || (snapshot.report?.unexpectedNamespaces || []).length !== 0) {
      throw new Error('Canonical staging blocked: the local Shadow scan has errors or unmapped namespaces.');
    }
    const migration = window.WLPCanonicalMigrationDryRun;
    if (!migration?.buildCanonical) throw new Error('Canonical Migration v194 transformer is not available.');
    const canonical = await migration.buildCanonical(snapshot);
    if (canonical.blocking.length) throw new Error(`Canonical staging blocked: ${canonical.blocking.length} migration issue(s) must be resolved first.`);
    return { snapshot, canonical };
  }

  function isExplicitTombstone(row) {
    return Boolean(row && typeof row === 'object' && row.deleted_at);
  }

  async function flattenCanonical(canonical) {
    const rows = [];
    for (const [tableName, tableRows] of Object.entries(canonical.tables)) {
      for (const payload of tableRows) {
        const rowKey = tablePrimaryKey(tableName, payload);
        if (!rowKey) throw new Error(`${tableName}: row without staging key.`);
        rows.push({
          tableName,
          rowKey,
          payload,
          payloadHash: await sha256(stableStringify(payload)),
          tombstone: isExplicitTombstone(payload)
        });
      }
    }
    rows.sort((a, b) => `${a.tableName}|${a.rowKey}`.localeCompare(`${b.tableName}|${b.rowKey}`));
    return rows;
  }

  async function reconstructCanonical(remoteRows, expectedTableNames = []) {
    const tables = Object.fromEntries(expectedTableNames.map(name => [name, []]));
    for (const row of remoteRows) {
      if (!tables[row.table_name]) tables[row.table_name] = [];
      tables[row.table_name].push(row.payload);
    }
    Object.entries(tables).forEach(([table, rows]) => {
      rows.sort((a, b) => tablePrimaryKey(table, a).localeCompare(tablePrimaryKey(table, b)));
    });
    const tableHashes = {};
    for (const [name, rows] of Object.entries(tables)) tableHashes[name] = await sha256(stableStringify(rows));
    return {
      tables,
      tableCounts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
      tableHashes,
      fullCanonicalHash: await sha256(stableStringify(tables))
    };
  }

  function referenceAudit(tables) {
    const blocking = [];
    const warnings = [];
    const cards = new Set((tables.cards || []).map(row => row.card_id));
    const requireCard = (table, field = 'card_id') => {
      const missing = (tables[table] || []).filter(row => row[field] && !cards.has(row[field]));
      if (missing.length) blocking.push(`${table}: ${missing.length} unresolved Card reference(s).`);
    };
    ['card_content','card_learning_metadata','learning_situations','learning_alternatives','card_classification','learning_events','learning_state','study_context_cards','study_build_cards'].forEach(table => requireCard(table));
    if ((tables.card_content || []).length !== (tables.cards || []).length) {
      blocking.push(`Card/content count mismatch: ${(tables.cards || []).length} cards vs ${(tables.card_content || []).length} content rows.`);
    }
    const situations = new Set((tables.learning_situations || []).map(row => row.situation_id));
    const alternatives = new Set((tables.learning_alternatives || []).map(row => row.alternative_id));
    const badAltLinks = (tables.learning_alternative_situations || []).filter(row => !situations.has(row.situation_id) || !alternatives.has(row.alternative_id));
    if (badAltLinks.length) blocking.push(`learning_alternative_situations: ${badAltLinks.length} unresolved link(s).`);
    const contexts = new Set((tables.study_contexts || []).map(row => row.context_id));
    const badContext = (tables.study_context_cards || []).filter(row => !contexts.has(row.context_id));
    if (badContext.length) blocking.push(`study_context_cards: ${badContext.length} unresolved Context reference(s).`);
    const builds = new Set((tables.study_builds || []).map(row => row.build_id));
    const badBuild = (tables.study_build_cards || []).filter(row => !builds.has(row.build_id));
    if (badBuild.length) blocking.push(`study_build_cards: ${badBuild.length} unresolved Build reference(s).`);
    const categories = new Set((tables.user_link_categories || []).map(row => row.category_id));
    const badLinks = (tables.user_links || []).filter(row => row.category_id && !categories.has(row.category_id));
    if (badLinks.length) blocking.push(`user_links: ${badLinks.length} unresolved Link Category reference(s).`);

    const sessions = new Set((tables.learning_sessions || []).map(row => row.session_id));
    const eventMissingSessions = (tables.learning_events || []).filter(row => row.session_id && !sessions.has(row.session_id));
    if (eventMissingSessions.length) warnings.push(`Learning Event historical sessions: ${eventMissingSessions.length} event(s) reference historical sessions not present in this snapshot.`);
    const contextMissingSessions = (tables.study_contexts || []).filter(row => row.session_id && !sessions.has(row.session_id));
    if (contextMissingSessions.length) warnings.push(`Study Context historical sessions: ${contextMissingSessions.length} context(s) reference historical sessions not present in this snapshot.`);
    return { blocking, warnings };
  }

  async function upsertRun(api, session, device, stageKey, snapshot, canonical, status, diagnostics = {}) {
    const now = new Date().toISOString();
    await api.rest('wlp_canonical_stage_runs?on_conflict=owner_id,device_key,stage_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: [{
        owner_id: session.userId,
        device_key: device.deviceKey,
        stage_key: stageKey,
        stage_schema_version: STAGE_SCHEMA_VERSION,
        migration_version: canonical.migrationVersion,
        namespace_uuid: canonical.namespaceUuid,
        app_version: APP_VERSION,
        status,
        source_snapshot_hash: snapshot.report?.snapshotHash || '',
        card_mapping_hash: canonical.hashes.cardMappingHash,
        core_library_hash: canonical.hashes.coreLibraryHash,
        personal_library_hash: canonical.hashes.personalLibraryHash,
        learning_hash: canonical.hashes.learningHash,
        full_canonical_hash: canonical.hashes.fullCanonicalHash,
        canonical_row_count: canonical.canonicalRows,
        table_counts: canonical.tableCounts,
        diagnostics: { auditWarnings: canonical.warnings, invariants: { noCloudToWlpApply: true, noAbsenceBasedDeletion: true }, ...diagnostics },
        last_staged_at: now
      }]
    });
  }

  async function uploadStageRows(api, session, device, stageKey, flatRows) {
    const batches = chunk(flatRows, 250);
    let uploaded = 0;
    for (let i = 0; i < batches.length; i += 1) {
      const now = new Date().toISOString();
      const body = batches[i].map(row => ({
        owner_id: session.userId,
        device_key: device.deviceKey,
        stage_key: stageKey,
        table_name: row.tableName,
        row_key: row.rowKey,
        payload: row.payload,
        payload_hash: row.payloadHash,
        tombstone: row.tombstone,
        observed_at: now
      }));
      await api.rest('wlp_canonical_stage_records?on_conflict=owner_id,device_key,stage_key,table_name,row_key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body
      });
      uploaded += body.length;
      setStatus(`Staging Canonical rows… ${uploaded.toLocaleString()} / ${flatRows.length.toLocaleString()}`, '');
      if (i && i % 8 === 0) await sleep(0);
    }
  }

  async function fetchRunRows(api, deviceKey, stageKey, includePayload) {
    const select = includePayload
      ? 'device_key,stage_key,table_name,row_key,payload_hash,tombstone,payload'
      : 'device_key,stage_key,table_name,row_key,payload_hash,tombstone';
    const extra = `device_key=eq.${encodeURIComponent(deviceKey)}&stage_key=eq.${encodeURIComponent(stageKey)}&order=table_name.asc,row_key.asc`;
    return api.fetchPaged('wlp_canonical_stage_records', select, extra);
  }

  async function fetchLatestRuns(api) {
    const runs = await api.fetchPaged(
      'wlp_canonical_stage_runs',
      'device_key,stage_key,status,last_staged_at,canonical_row_count,table_counts,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,personal_library_hash,learning_hash,full_canonical_hash,diagnostics',
      'status=eq.verified&order=last_staged_at.desc'
    );
    const latest = new Map();
    runs.forEach(run => { if (!latest.has(run.device_key)) latest.set(run.device_key, run); });
    return [...latest.values()];
  }

  function runCompatibilityAudit(latestRuns) {
    const distinct = key => new Set(latestRuns.map(run => String(run[key] || '')).filter(Boolean));
    const namespaceUuids = distinct('namespace_uuid');
    const migrationVersions = distinct('migration_version');
    const cardMappingHashes = distinct('card_mapping_hash');
    const coreLibraryHashes = distinct('core_library_hash');
    return {
      namespaceMatch: namespaceUuids.size <= 1,
      migrationVersionMatch: migrationVersions.size <= 1,
      cardMappingHashMatch: cardMappingHashes.size <= 1,
      coreLibraryHashMatch: coreLibraryHashes.size <= 1,
      namespaceUuids: [...namespaceUuids],
      migrationVersions: [...migrationVersions],
      cardMappingHashes: [...cardMappingHashes],
      coreLibraryHashes: [...coreLibraryHashes]
    };
  }

  function unionAudit(rows) {
    const tables = new Map();
    rows.forEach(row => {
      if (!tables.has(row.table_name)) tables.set(row.table_name, new Map());
      const keys = tables.get(row.table_name);
      if (!keys.has(row.row_key)) keys.set(row.row_key, []);
      keys.get(row.row_key).push(row);
    });
    const result = {};
    let unionRows = 0;
    let historyUnionRows = 0;
    let coreDivergences = 0;
    let divergentCollisions = 0;
    let identicalDuplicates = 0;
    for (const [table, keys] of tables.entries()) {
      let identical = 0;
      let divergent = 0;
      for (const variants of keys.values()) {
        if (variants.length < 2) continue;
        const signatures = new Set(variants.map(row => `${row.payload_hash}|${Boolean(row.tombstone)}`));
        if (signatures.size === 1) identical += variants.length - 1;
        else divergent += 1;
      }
      result[table] = { unionKeys: keys.size, identicalDuplicates: identical, divergentCollisions: divergent };
      unionRows += keys.size;
      if (UNION_HISTORY_TABLES.has(table)) historyUnionRows += keys.size;
      identicalDuplicates += identical;
      divergentCollisions += divergent;
      if (CORE_LIBRARY_TABLES.has(table)) coreDivergences += divergent;
    }
    return { tables: result, unionRows, historyUnionRows, identicalDuplicates, divergentCollisions, coreDivergences };
  }

  async function verifySelfReadBack(api, device, stageKey, canonical, flatRows) {
    const remoteRows = await fetchRunRows(api, device.deviceKey, stageKey, true);
    const reconstructed = await reconstructCanonical(remoteRows, Object.keys(canonical.tables));
    const audit = referenceAudit(reconstructed.tables);
    const tombstonesLocal = flatRows.filter(row => row.tombstone).length;
    const tombstonesCloud = remoteRows.filter(row => row.tombstone).length;
    const tableCountMatch = stableStringify(reconstructed.tableCounts) === stableStringify(canonical.tableCounts);
    const tableHashMatch = Object.entries(canonical.hashes.tableHashes).every(([name, hash]) => reconstructed.tableHashes[name] === hash);
    const fullHashMatch = reconstructed.fullCanonicalHash === canonical.hashes.fullCanonicalHash;
    return {
      remoteRows,
      reconstructed,
      audit,
      checks: {
        rowCountMatch: remoteRows.length === canonical.canonicalRows,
        tableCountMatch,
        tableHashMatch,
        fullHashMatch,
        tombstoneCountMatch: tombstonesLocal === tombstonesCloud,
        referenceIntegrity: audit.blocking.length === 0
      },
      tombstonesLocal,
      tombstonesCloud
    };
  }

  async function readCrossDeviceAudit(api, latestRuns) {
    const rows = [];
    for (let i = 0; i < latestRuns.length; i += 1) {
      const run = latestRuns[i];
      const deviceRows = await fetchRunRows(api, run.device_key, run.stage_key, false);
      rows.push(...deviceRows);
      setStatus(`Reading latest staged device snapshots… ${i + 1} / ${latestRuns.length}`, '');
    }
    return { rows, union: unionAudit(rows), compatibility: runCompatibilityAudit(latestRuns) };
  }

  async function exactCount(api, path) {
    const { data, response } = await api.rest(path, { headers: { Range: '0-0', Prefer: 'count=exact' } });
    const range = response.headers.get('content-range') || '';
    const totalText = range.split('/')[1];
    const total = Number(totalText);
    if (Number.isFinite(total)) return total;
    return Array.isArray(data) ? data.length : 0;
  }

  async function countExistingStage(api, deviceKey, stageKey) {
    const filters = `device_key=eq.${encodeURIComponent(deviceKey)}&stage_key=eq.${encodeURIComponent(stageKey)}`;
    const runCount = await exactCount(api, `wlp_canonical_stage_runs?select=stage_key&${filters}`);
    const recordCount = await exactCount(api, `wlp_canonical_stage_records?select=row_key&${filters}`);
    return { runCount, recordCount };
  }

  function stagePass(self, cross) {
    const checks = Object.values(self.checks).every(Boolean);
    const compatibility = cross.compatibility || { namespaceMatch: true, migrationVersionMatch: true, cardMappingHashMatch: true, coreLibraryHashMatch: true };
    return checks
      && cross.union.coreDivergences === 0
      && compatibility.namespaceMatch
      && compatibility.migrationVersionMatch
      && compatibility.cardMappingHashMatch
      && compatibility.coreLibraryHashMatch;
  }

  async function stageCanonical(retryOnly = false) {
    if (state.busy) return;
    setBusy(true);
    setStatus(retryOnly ? 'Rebuilding the current Canonical representation for retry verification…' : 'Building the current Canonical representation for staging…', '');
    try {
      const api = supabaseApi();
      const { snapshot, canonical } = await buildLocalCanonical();
      const flatRows = await flattenCanonical(canonical);
      const stageKey = `v1:${canonical.hashes.fullCanonicalHash}`;
      if (retryOnly && state.lastStageKey && stageKey !== state.lastStageKey) {
        throw new Error('Retry blocked: the local Canonical representation changed since the previous stage. Run Stage Canonical + Round-trip instead.');
      }
      const session = await api.ensureSession();
      const device = await api.registerDevice();
      const before = await countExistingStage(api, device.deviceKey, stageKey);
      if (retryOnly && before.runCount !== 1) throw new Error('Retry blocked: this exact stage snapshot is not present once in Cloud staging yet.');

      await upsertRun(api, session, device, stageKey, snapshot, canonical, 'started', { retryRequested: retryOnly });
      await uploadStageRows(api, session, device, stageKey, flatRows);
      const self = await verifySelfReadBack(api, device, stageKey, canonical, flatRows);
      const after = await countExistingStage(api, device.deviceKey, stageKey);
      const retryIdempotent = retryOnly
        ? before.runCount === 1 && after.runCount === 1 && before.recordCount === after.recordCount && after.recordCount === canonical.canonicalRows
        : null;

      await upsertRun(api, session, device, stageKey, snapshot, canonical, Object.values(self.checks).every(Boolean) ? 'verified' : 'failed', {
        retryRequested: retryOnly,
        retryIdempotent,
        selfChecks: self.checks,
        readBackHash: self.reconstructed.fullCanonicalHash,
        referenceWarnings: self.audit.warnings
      });

      const latestRuns = await fetchLatestRuns(api);
      const cross = await readCrossDeviceAudit(api, latestRuns);
      const pass = stagePass(self, cross) && (!retryOnly || retryIdempotent === true);
      state.lastStageKey = stageKey;
      state.lastFullHash = canonical.hashes.fullCanonicalHash;
      state.report = makeReport({ snapshot, canonical, flatRows, stageKey, device, latestRuns, self, cross, retryOnly, retryIdempotent, pass, before, after });
      render(state.report);
      setStatus(pass
        ? `Canonical staging round-trip PASS · ${canonical.canonicalRows.toLocaleString()} rows read back exactly${retryOnly ? ' · retry idempotency PASS' : ''} · no Cloud data applied to WLP.`
        : 'Canonical staging completed with checks requiring inspection. No Cloud data was applied to WLP.', pass ? 'success' : 'error');
    } catch (error) {
      console.error('WLP Canonical staging:', error);
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function crossDeviceIssues(cross) {
    const issues = [];
    const union = cross?.union || {};
    const compatibility = cross?.compatibility || {};
    const coreDivergences = Number(union.coreDivergences || 0);
    const divergentCollisions = Number(union.divergentCollisions || 0);

    if (coreDivergences > 0) {
      issues.push(`BLOCKING · Core Personal Library has ${coreDivergences} divergent row-key collision(s) across staged devices.`);
    }
    if (compatibility.namespaceMatch === false) {
      issues.push('BLOCKING · Canonical UUID namespace differs across staged devices.');
    }
    if (compatibility.migrationVersionMatch === false) {
      issues.push('BLOCKING · Canonical migration version differs across staged devices.');
    }
    if (compatibility.cardMappingHashMatch === false) {
      issues.push('BLOCKING · Card Mapping Hash differs across staged devices.');
    }
    if (compatibility.coreLibraryHashMatch === false) {
      issues.push('BLOCKING · Core Library Hash differs across staged devices.');
    }

    const nonCoreDivergences = Math.max(0, divergentCollisions - coreDivergences);
    if (nonCoreDivergences > 0) {
      issues.push(`AUDIT · ${nonCoreDivergences} non-core/history row-key collision(s) differ across devices and remain preserved for Canonical merge inspection.`);
    }
    return issues;
  }

  async function readCanonicalStage() {
    if (state.busy) return;
    setBusy(true);
    setStatus('Reading latest Canonical staging snapshots only. Nothing will be applied to WLP…', '');
    try {
      const api = supabaseApi();
      await api.ensureSession();
      const latestRuns = await fetchLatestRuns(api);
      if (!latestRuns.length) throw new Error('No Canonical staging runs found for this account.');
      const cross = await readCrossDeviceAudit(api, latestRuns);
      const currentDevice = await api.getDevice();
      const currentRun = latestRuns.find(run => run.device_key === currentDevice.deviceKey) || null;
      state.report = {
        format: 'WLP_CANONICAL_CLOUD_STAGE_REPORT', version: 1, stageSchemaVersion: STAGE_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(), mode: 'read-only', currentDeviceKey: currentDevice.deviceKey,
        latestRuns, crossDevice: { ...cross.union, compatibility: cross.compatibility },
        issues: crossDeviceIssues(cross),
        invariants: { noCloudToWlpApply: true, noWlpWrites: true, noAbsenceBasedDeletion: true, stagingOnly: true },
        summary: {
          pass: cross.union.coreDivergences === 0 && Object.values({
            namespaceMatch: cross.compatibility.namespaceMatch,
            migrationVersionMatch: cross.compatibility.migrationVersionMatch,
            cardMappingHashMatch: cross.compatibility.cardMappingHashMatch,
            coreLibraryHashMatch: cross.compatibility.coreLibraryHashMatch
          }).every(Boolean),
          latestDevices: latestRuns.length,
          coreDivergences: cross.union.coreDivergences + (cross.compatibility.coreLibraryHashMatch ? 0 : 1) + (cross.compatibility.cardMappingHashMatch ? 0 : 1),
          unionRows: cross.union.unionRows,
          historyUnionRows: cross.union.historyUnionRows,
          tombstones: cross.rows.filter(row => row.tombstone).length,
          currentStageKey: currentRun?.stage_key || ''
        }
      };
      render(state.report);
      const readPass = state.report.summary.pass;
      setStatus(readPass
        ? `Cloud staging read complete · ${latestRuns.length} latest device snapshot(s) · canonical identity/core compatibility PASS · no WLP data modified.`
        : 'Cloud staging read complete with canonical identity/core compatibility checks requiring inspection · no WLP data modified.',
      readPass ? 'success' : 'error');
    } catch (error) {
      console.error('WLP Canonical staging read:', error);
      setStatus(error?.message || String(error), 'error');
    } finally { setBusy(false); }
  }

  function makeReport({ snapshot, canonical, flatRows, stageKey, device, latestRuns, self, cross, retryOnly, retryIdempotent, pass, before, after }) {
    const issues = [
      ...self.audit.blocking.map(value => `BLOCKING · ${value}`),
      ...self.audit.warnings.map(value => `AUDIT · ${value}`)
    ];
    issues.push(...crossDeviceIssues(cross));
    if (retryOnly && retryIdempotent !== true) issues.push('BLOCKING · Retry idempotency check did not pass.');
    if (!flatRows.some(row => row.tombstone)) issues.push('AUDIT · No explicit tombstones exist in this local Canonical snapshot, so tombstone transport is configured but not empirically exercised by current data.');
    return {
      format: 'WLP_CANONICAL_CLOUD_STAGE_REPORT', version: 1, stageSchemaVersion: STAGE_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(), mode: retryOnly ? 'retry' : 'stage-round-trip',
      currentDeviceKey: device.deviceKey, stageKey,
      source: { snapshotHash: snapshot.report?.snapshotHash || '', fullCanonicalHash: canonical.hashes.fullCanonicalHash },
      hashes: canonical.hashes,
      tableCounts: canonical.tableCounts,
      selfRoundTrip: { checks: self.checks, readBackHash: self.reconstructed.fullCanonicalHash, readBackRows: self.remoteRows.length, referenceAudit: self.audit },
      retry: { requested: retryOnly, idempotent: retryIdempotent, before, after },
      latestRuns,
      crossDevice: { ...cross.union, compatibility: cross.compatibility },
      issues,
      summary: {
        pass,
        localCanonicalRows: canonical.canonicalRows,
        selfReadBackRows: self.remoteRows.length,
        latestDevices: latestRuns.length,
        coreDivergences: cross.union.coreDivergences + (cross.compatibility.coreLibraryHashMatch ? 0 : 1) + (cross.compatibility.cardMappingHashMatch ? 0 : 1),
        unionRows: cross.union.unionRows,
          historyUnionRows: cross.union.historyUnionRows,
        tombstones: self.tombstonesCloud
      },
      invariants: { noCloudToWlpApply: true, noWlpWrites: true, noAbsenceBasedDeletion: true, stagingOnly: true }
    };
  }

  function render(report) {
    const summary = report.summary || {};
    $('staging-local-rows').textContent = Number(summary.localCanonicalRows || report.tableCounts && Object.values(report.tableCounts).reduce((a, b) => a + Number(b || 0), 0) || 0).toLocaleString();
    $('staging-cloud-rows').textContent = Number(summary.selfReadBackRows || 0).toLocaleString();
    $('staging-device-count').textContent = Number(summary.latestDevices || 0).toLocaleString();
    $('staging-core-divergences').textContent = Number(summary.coreDivergences || 0).toLocaleString();
    $('staging-union-rows').textContent = Number(summary.historyUnionRows || summary.unionRows || 0).toLocaleString();
    $('staging-tombstones').textContent = Number(summary.tombstones || 0).toLocaleString();
    $('staging-key').textContent = report.stageKey || summary.currentStageKey || '—';
    $('staging-readback-hash').textContent = report.selfRoundTrip?.readBackHash || '—';
    $('staging-result').textContent = summary.pass ? 'PASS' : 'CHECK';
    $('staging-result').className = summary.pass ? 'compare-pass' : 'compare-check';

    const deviceBody = $('staging-device-body');
    deviceBody.innerHTML = '';
    (report.latestRuns || []).forEach(run => {
      const tr = document.createElement('tr');
      [run.device_key, run.canonical_row_count, String(run.core_library_hash || '').slice(0, 12), String(run.learning_hash || '').slice(0, 12), run.status].forEach(value => {
        const td = document.createElement('td'); td.textContent = String(value ?? ''); tr.appendChild(td);
      });
      deviceBody.appendChild(tr);
    });

    const unionBody = $('staging-union-body');
    unionBody.innerHTML = '';
    Object.entries(report.crossDevice?.tables || {}).sort((a, b) => a[0].localeCompare(b[0])).forEach(([table, item]) => {
      const tr = document.createElement('tr');
      [table, item.unionKeys, item.identicalDuplicates, item.divergentCollisions].forEach(value => {
        const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td);
      });
      unionBody.appendChild(tr);
    });

    const issues = $('staging-issues');
    issues.innerHTML = '';
    const values = report.issues || [];
    if (!values.length) {
      const li = document.createElement('li'); li.textContent = 'No staging integrity issues detected.'; issues.appendChild(li);
    } else values.forEach(value => { const li = document.createElement('li'); li.textContent = value; issues.appendChild(li); });

    $('staging-panel').classList.remove('hidden');
    $('export-stage').disabled = false;
    $('retry-canonical-stage').disabled = state.busy || !report.stageKey;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-cloud-stage-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('staging-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }

  function setBusy(value) { state.busy = Boolean(value); refreshButtons(); }

  function refreshButtons() {
    const snapshot = window.WLPCloudShadow?.getLatestSnapshot?.();
    const apiState = window.WLPCloudShadowSupabase?.getState?.() || {};
    const ready = Boolean(snapshot && apiState.configured && apiState.signedIn);
    $('stage-canonical').disabled = state.busy || !ready;
    $('read-canonical-stage').disabled = state.busy || !apiState.configured || !apiState.signedIn;
    $('retry-canonical-stage').disabled = state.busy || !ready || !state.lastStageKey;
    $('export-stage').disabled = state.busy || !state.report;
  }

  function resetAfterScan() {
    state.report = null;
    state.lastStageKey = '';
    state.lastFullHash = '';
    $('export-stage').disabled = true;
    $('retry-canonical-stage').disabled = true;
    if (!$('staging-panel').classList.contains('hidden')) setStatus('Local snapshot refreshed. Run Canonical staging again before relying on the previous round-trip report.', '');
    refreshButtons();
  }

  function init() {
    $('stage-canonical').addEventListener('click', () => stageCanonical(false));
    $('retry-canonical-stage').addEventListener('click', () => stageCanonical(true));
    $('read-canonical-stage').addEventListener('click', readCanonicalStage);
    $('export-stage').addEventListener('click', exportReport);
    window.addEventListener('wlp-cloud-shadow-scan-complete', resetAfterScan);
    window.addEventListener('wlp-cloud-shadow-auth-state', refreshButtons);
    window.addEventListener('focus', refreshButtons);
    setTimeout(refreshButtons, 0);
    setTimeout(refreshButtons, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
