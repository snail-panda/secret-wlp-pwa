/* WLP Canonical Cutover Preflight v1.
   Fully hydrates the deterministic v200 merged Canonical snapshot from the
   latest verified staging snapshots plus the in-memory materialized merges,
   verifies payload hashes, canonical row identities, table manifests and
   references, and emits a deterministic cutover ticket. Read only: no
   Supabase writes, no WLP writes, no Cloud -> Local apply, no automatic cutover. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.202-canonical-cutover-preflight-v1';
  const HASH_BATCH = 128;
  const state = { busy: false, report: null, hydratedRows: null };

  const PK = Object.freeze({
    cards: row => row.card_id,
    card_content: row => row.card_id,
    card_learning_metadata: row => row.card_id,
    learning_situations: row => row.situation_id,
    learning_alternatives: row => row.alternative_id,
    learning_alternative_situations: row => `${row.alternative_id}|${row.situation_id}`,
    card_classification: row => row.card_id,
    learning_sessions: row => row.session_id,
    learning_events: row => row.event_id,
    learning_state: row => row.card_id,
    learner_profile: () => 'account',
    learner_route_state: () => 'account',
    study_contexts: row => row.context_id,
    study_context_cards: row => `${row.context_id}|${row.ordinal}`,
    study_builds: row => row.build_id,
    study_build_cards: row => `${row.build_id}|${row.ordinal}`,
    user_link_categories: row => row.category_id,
    user_links: row => row.link_id,
    user_preferences: row => row.section
  });
  const KNOWN_TABLES = new Set(Object.keys(PK));

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
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function identity(tableName, rowKey) { return `${tableName}\u0000${rowKey}`; }
  function splitIdentity(value) {
    const at = value.indexOf('\u0000');
    return [value.slice(0, at), value.slice(at + 1)];
  }
  function shortDevice(value) {
    const text = String(value || '');
    return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text;
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function supabaseApi() {
    const api = window.WLPCloudShadowSupabase;
    if (!api?.ensureSession || !api?.fetchPaged) throw new Error('Shadow Supabase transport is not ready. Reload this diagnostics page.');
    return api;
  }

  function expectedManifest(auditInput, materialization) {
    const materialized = new Map((materialization.materializedRows || []).map(row => [identity(row.tableName, row.rowKey), row]));
    const groups = new Map();
    (auditInput.fingerprintRows || []).forEach(row => {
      const key = identity(row.table_name, row.row_key);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    const out = [];
    for (const [key, rows] of groups) {
      const [tableName, rowKey] = splitIdentity(key);
      const signatures = new Set(rows.map(row => `${row.payload_hash}|${Boolean(row.tombstone)}`));
      if (signatures.size === 1) {
        const chosen = [...rows].sort((a, b) => String(a.device_key).localeCompare(String(b.device_key)))[0];
        out.push({
          tableName, rowKey, payloadHash: chosen.payload_hash, tombstone: Boolean(chosen.tombstone),
          kind: rows.length > 1 ? 'identical-source' : 'unique-source',
          sourceDevices: [...new Set(rows.map(row => row.device_key))].sort()
        });
        continue;
      }
      const merged = materialized.get(key);
      if (!merged) throw new Error(`Materialization payload is missing for divergent ${tableName}|${rowKey}.`);
      out.push({
        tableName, rowKey, payloadHash: merged.payloadHash, tombstone: false,
        kind: 'materialized-merge', sourceDevices: clone(merged.sourceDevices || [])
      });
    }
    return out.sort((a, b) => identity(a.tableName, a.rowKey).localeCompare(identity(b.tableName, b.rowKey)));
  }

  async function fetchStageRows(api, run, tableName = '') {
    const tableFilter = tableName ? `&table_name=eq.${encodeURIComponent(tableName)}` : '';
    return api.fetchPaged(
      'wlp_canonical_stage_records',
      'device_key,stage_key,table_name,row_key,payload_hash,tombstone,payload',
      `device_key=eq.${encodeURIComponent(run.device_key)}&stage_key=eq.${encodeURIComponent(run.stage_key)}${tableFilter}&order=table_name.asc,row_key.asc`
    );
  }

  function mapRows(rows) {
    const out = new Map();
    rows.forEach(row => out.set(identity(row.table_name, row.row_key), row));
    return out;
  }

  async function hydrateFinalRows(api, auditInput, materialization, manifest) {
    const runs = [...(auditInput.latestRuns || [])];
    if (runs.length < 2) throw new Error('Cutover Preflight requires at least two verified staged device snapshots.');
    const baseRun = [...runs].sort((a, b) => Number(b.canonical_row_count || 0) - Number(a.canonical_row_count || 0))[0];
    setStatus(`Hydrating verified base snapshot from ${shortDevice(baseRun.device_key)}…`, '');
    const baseRows = await fetchStageRows(api, baseRun);
    if (baseRows.length !== Number(baseRun.canonical_row_count || 0)) {
      throw new Error(`Base staged payload read-back count mismatch: expected ${baseRun.canonical_row_count}, read ${baseRows.length}.`);
    }
    const baseMap = mapRows(baseRows);
    const materializedMap = new Map((materialization.materializedRows || []).map(row => [identity(row.tableName, row.rowKey), row]));
    const fingerprintGroups = new Map();
    (auditInput.fingerprintRows || []).forEach(row => {
      const key = identity(row.table_name, row.row_key);
      if (!fingerprintGroups.has(key)) fingerprintGroups.set(key, []);
      fingerprintGroups.get(key).push(row);
    });

    const hydrated = new Map();
    const unresolved = [];
    const fallbackNeeds = new Map();

    for (const item of manifest) {
      const key = identity(item.tableName, item.rowKey);
      if (item.kind === 'materialized-merge') {
        const merged = materializedMap.get(key);
        if (!merged?.payload) { unresolved.push(key); continue; }
        hydrated.set(key, {
          tableName: item.tableName, rowKey: item.rowKey, payloadHash: item.payloadHash,
          tombstone: Boolean(item.tombstone), payload: clone(merged.payload), source: 'materialized-merge'
        });
        continue;
      }
      const base = baseMap.get(key);
      if (base && base.payload_hash === item.payloadHash && Boolean(base.tombstone) === Boolean(item.tombstone)) {
        hydrated.set(key, {
          tableName: item.tableName, rowKey: item.rowKey, payloadHash: item.payloadHash,
          tombstone: Boolean(item.tombstone), payload: clone(base.payload), source: `stage:${baseRun.device_key}`
        });
        continue;
      }
      const candidates = (fingerprintGroups.get(key) || [])
        .filter(row => row.payload_hash === item.payloadHash && Boolean(row.tombstone) === Boolean(item.tombstone))
        .sort((a, b) => String(a.device_key).localeCompare(String(b.device_key)));
      const candidate = candidates.find(row => row.device_key !== baseRun.device_key) || candidates[0];
      if (!candidate) { unresolved.push(key); continue; }
      const needKey = `${candidate.device_key}\u0000${item.tableName}`;
      if (!fallbackNeeds.has(needKey)) fallbackNeeds.set(needKey, { deviceKey: candidate.device_key, tableName: item.tableName, keys: new Set() });
      fallbackNeeds.get(needKey).keys.add(key);
    }

    let fallbackRowsFetched = 0;
    const runByDevice = new Map(runs.map(run => [run.device_key, run]));
    for (const need of fallbackNeeds.values()) {
      const run = runByDevice.get(need.deviceKey);
      if (!run) { unresolved.push(...need.keys); continue; }
      setStatus(`Hydrating fallback ${need.tableName} payloads from ${shortDevice(need.deviceKey)}…`, '');
      const rows = await fetchStageRows(api, run, need.tableName);
      fallbackRowsFetched += rows.length;
      const rowMap = mapRows(rows);
      for (const key of need.keys) {
        if (hydrated.has(key)) continue;
        const expected = manifest.find(item => identity(item.tableName, item.rowKey) === key);
        const row = rowMap.get(key);
        if (!row || !expected || row.payload_hash !== expected.payloadHash || Boolean(row.tombstone) !== Boolean(expected.tombstone)) {
          unresolved.push(key);
          continue;
        }
        hydrated.set(key, {
          tableName: row.table_name, rowKey: row.row_key, payloadHash: row.payload_hash,
          tombstone: Boolean(row.tombstone), payload: clone(row.payload), source: `stage:${need.deviceKey}`
        });
      }
    }

    return {
      baseRun,
      baseRowsFetched: baseRows.length,
      fallbackRowsFetched,
      rows: manifest.map(item => hydrated.get(identity(item.tableName, item.rowKey))).filter(Boolean),
      unresolved: [...new Set(unresolved)].sort()
    };
  }

  async function verifyPayloadHashes(rows) {
    let verified = 0;
    const mismatches = [];
    for (let start = 0; start < rows.length; start += HASH_BATCH) {
      const batch = rows.slice(start, start + HASH_BATCH);
      const hashes = await Promise.all(batch.map(row => sha256(stableStringify(row.payload))));
      hashes.forEach((hash, index) => {
        const row = batch[index];
        if (hash === row.payloadHash) verified += 1;
        else mismatches.push(`${row.tableName}|${row.rowKey}`);
      });
      setStatus(`Verifying hydrated payload hashes… ${Math.min(start + HASH_BATCH, rows.length).toLocaleString()} / ${rows.length.toLocaleString()}`, '');
      if (start && start % (HASH_BATCH * 8) === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return { verified, mismatches };
  }

  function primaryKeyAudit(rows) {
    const blocking = [];
    let checked = 0;
    rows.forEach(row => {
      if (!KNOWN_TABLES.has(row.tableName)) {
        blocking.push(`Unknown Canonical table in final snapshot: ${row.tableName}.`);
        return;
      }
      if (row.tombstone) return;
      if (!row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) {
        blocking.push(`${row.tableName}|${row.rowKey}: live row has no object payload.`);
        return;
      }
      const derived = String(PK[row.tableName](row.payload) ?? '');
      checked += 1;
      if (!derived || derived !== String(row.rowKey)) blocking.push(`${row.tableName}|${row.rowKey}: payload primary key resolves to ${derived || '(empty)'}.`);
    });
    return { checked, blocking };
  }

  function tablePayloads(rows) {
    const tables = {};
    rows.filter(row => !row.tombstone).forEach(row => {
      tables[row.tableName] ||= [];
      tables[row.tableName].push(row.payload);
    });
    return tables;
  }

  function referenceAudit(rows) {
    const tables = tablePayloads(rows);
    const blocking = [];
    const warnings = [];
    const cards = new Set((tables.cards || []).map(row => row.card_id));
    const requireCard = (table, field = 'card_id') => {
      const missing = (tables[table] || []).filter(row => row?.[field] && !cards.has(row[field]));
      if (missing.length) blocking.push(`${table}: ${missing.length} unresolved live Card reference(s).`);
    };
    ['card_content','card_learning_metadata','learning_situations','learning_alternatives','card_classification','learning_events','learning_state','study_context_cards','study_build_cards'].forEach(table => requireCard(table));

    const cardContent = new Set((tables.card_content || []).map(row => row.card_id));
    const cardsWithoutContent = [...cards].filter(cardId => !cardContent.has(cardId));
    const contentWithoutCard = [...cardContent].filter(cardId => !cards.has(cardId));
    if (cardsWithoutContent.length || contentWithoutCard.length) blocking.push(`Card/content identity mismatch: ${cardsWithoutContent.length} card(s) without content, ${contentWithoutCard.length} content row(s) without card.`);

    const situations = new Set((tables.learning_situations || []).map(row => row.situation_id));
    const alternatives = new Set((tables.learning_alternatives || []).map(row => row.alternative_id));
    const badAltLinks = (tables.learning_alternative_situations || []).filter(row => !situations.has(row.situation_id) || !alternatives.has(row.alternative_id));
    if (badAltLinks.length) blocking.push(`learning_alternative_situations: ${badAltLinks.length} unresolved live link(s).`);

    const contexts = new Set((tables.study_contexts || []).map(row => row.context_id));
    const badContext = (tables.study_context_cards || []).filter(row => !contexts.has(row.context_id));
    if (badContext.length) blocking.push(`study_context_cards: ${badContext.length} unresolved live Context reference(s).`);
    const badCurrentCard = (tables.study_contexts || []).filter(row => row.current_card_id && !cards.has(row.current_card_id));
    if (badCurrentCard.length) blocking.push(`study_contexts: ${badCurrentCard.length} unresolved current_card_id reference(s).`);

    const builds = new Set((tables.study_builds || []).map(row => row.build_id));
    const badBuild = (tables.study_build_cards || []).filter(row => !builds.has(row.build_id));
    if (badBuild.length) blocking.push(`study_build_cards: ${badBuild.length} unresolved live Build reference(s).`);

    const categories = new Set((tables.user_link_categories || []).map(row => row.category_id));
    const badLinks = (tables.user_links || []).filter(row => row.category_id && !categories.has(row.category_id));
    if (badLinks.length) blocking.push(`user_links: ${badLinks.length} unresolved live Link Category reference(s).`);

    const sessions = new Set((tables.learning_sessions || []).map(row => row.session_id));
    const eventMissingSessions = (tables.learning_events || []).filter(row => row.session_id && !sessions.has(row.session_id));
    const contextMissingSessions = (tables.study_contexts || []).filter(row => row.session_id && !sessions.has(row.session_id));
    if (eventMissingSessions.length) warnings.push(`Learning Event historical sessions: ${eventMissingSessions.length} event(s) still reference historical sessions absent from the merged snapshot.`);
    if (contextMissingSessions.length) warnings.push(`Study Context historical sessions: ${contextMissingSessions.length} context(s) still reference historical sessions absent from the merged snapshot.`);

    const events = new Set((tables.learning_events || []).map(row => row.event_id));
    const missingSupersedes = (tables.learning_events || []).filter(row => row.supersedes_event_id && !events.has(row.supersedes_event_id));
    if (missingSupersedes.length) warnings.push(`Learning Event supersedes references: ${missingSupersedes.length} historical referenced event(s) are absent from the merged snapshot.`);

    return {
      blocking,
      warnings,
      counts: {
        cards: cards.size,
        cardContent: cardContent.size,
        eventMissingSessions: eventMissingSessions.length,
        contextMissingSessions: contextMissingSessions.length,
        missingSupersedes: missingSupersedes.length
      }
    };
  }

  function tableCounts(rows) {
    const out = {};
    rows.forEach(row => { out[row.tableName] = (out[row.tableName] || 0) + 1; });
    return out;
  }

  async function manifestProof(rows) {
    const hashRows = [...rows].sort((a, b) => identity(a.tableName, a.rowKey).localeCompare(identity(b.tableName, b.rowKey))).map(row => ({
      tableName: row.tableName, rowKey: row.rowKey, tombstone: Boolean(row.tombstone), payloadHash: row.payloadHash
    }));
    const counts = tableCounts(rows);
    const snapshotManifestHash = await sha256(stableStringify(hashRows));
    const tableManifestHashes = {};
    for (const tableName of Object.keys(counts).sort()) {
      tableManifestHashes[tableName] = await sha256(stableStringify(hashRows.filter(row => row.tableName === tableName)));
    }
    return { counts, snapshotManifestHash, tableManifestHashes };
  }

  function compareObjects(expected, actual, label, blocking) {
    const keys = new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})]);
    [...keys].sort().forEach(key => {
      if (String(expected?.[key] ?? '') !== String(actual?.[key] ?? '')) blocking.push(`${label} mismatch for ${key}: expected ${expected?.[key] ?? '(missing)'}, got ${actual?.[key] ?? '(missing)'}.`);
    });
  }

  async function analyzeOnce(auditInput, materialization, hydrated) {
    const blocking = [];
    const warnings = [];
    const manifest = expectedManifest(auditInput, materialization);
    if (hydrated.unresolved.length) blocking.push(`Full payload hydration is missing ${hydrated.unresolved.length} final row identity/identities.`);
    if (hydrated.rows.length !== manifest.length) blocking.push(`Hydrated row count mismatch: expected ${manifest.length}, hydrated ${hydrated.rows.length}.`);

    const payloadHashes = await verifyPayloadHashes(hydrated.rows);
    if (payloadHashes.mismatches.length) blocking.push(`Payload SHA-256 mismatch on ${payloadHashes.mismatches.length} hydrated row(s).`);

    const pk = primaryKeyAudit(hydrated.rows);
    blocking.push(...pk.blocking);

    const refs = referenceAudit(hydrated.rows);
    blocking.push(...refs.blocking);
    warnings.push(...refs.warnings);

    const proof = await manifestProof(hydrated.rows);
    if (proof.snapshotManifestHash !== materialization.hashes?.snapshotManifestHash) blocking.push('Rehydrated full snapshot manifest hash does not match v200 materialization.');
    compareObjects(materialization.tableCounts || {}, proof.counts, 'Table row count', blocking);
    compareObjects(materialization.hashes?.tableManifestHashes || {}, proof.tableManifestHashes, 'Table manifest hash', blocking);

    const tombstoneRows = hydrated.rows.filter(row => row.tombstone).length;
    if (!tombstoneRows) warnings.push('No explicit tombstones exist in this cutover candidate; tombstone transport remains unexercised by current real data.');
    warnings.push('This preflight fully hydrates final payloads but performs no Canonical Cloud write and no Cloud -> WLP apply.');
    warnings.push('Historical missing session references remain audit warnings unless they point to a required live parent; they are not synthesized during cutover.');

    const latestRuns = clone(auditInput.latestRuns || []);
    const ticketBasis = {
      namespaceUuid: latestRuns[0]?.namespace_uuid || '',
      migrationVersion: latestRuns[0]?.migration_version || '',
      cardMappingHash: latestRuns[0]?.card_mapping_hash || '',
      coreLibraryHash: latestRuns[0]?.core_library_hash || '',
      sourcePlanHash: materialization.sourcePlanHash || '',
      snapshotManifestHash: proof.snapshotManifestHash,
      tableManifestHashes: proof.tableManifestHashes,
      tableCounts: proof.counts
    };
    const cutoverTicketHash = await sha256(stableStringify(ticketBasis));

    return {
      summary: {
        sourceDevices: latestRuns.length,
        unionRows: manifest.length,
        hydratedRows: hydrated.rows.length,
        payloadHashesVerified: payloadHashes.verified,
        payloadHashMismatches: payloadHashes.mismatches.length,
        primaryKeysChecked: pk.checked,
        referenceBlocking: refs.blocking.length,
        historicalWarnings: refs.warnings.length,
        tombstoneRows,
        blockingIssues: blocking.length,
        pass: blocking.length === 0
      },
      proof,
      referenceCounts: refs.counts,
      cutoverTicketHash,
      blocking,
      warnings
    };
  }

  async function runPreflight() {
    if (state.busy) return;
    setBusy(true);
    setStatus('Starting full-payload Canonical cutover preflight. Read only; no data will be written…', '');
    try {
      const auditInput = window.WLPCanonicalMergeAudit?.getSimulationInput?.();
      const materialization = window.WLPCanonicalMergeMaterialization?.getReport?.();
      if (!auditInput?.fingerprintRows || !auditInput?.latestRuns) throw new Error('Run Audit Canonical Merge first in this page session.');
      if (!materialization?.summary?.pass) throw new Error('Run Materialize Merged Snapshot and obtain PASS first.');
      if (Object.values(materialization.compatibility || {}).some(value => value === false)) throw new Error('Canonical compatibility is not a clean PASS.');

      const api = supabaseApi();
      await api.ensureSession();
      const manifest = expectedManifest(auditInput, materialization);
      const hydrated = await hydrateFinalRows(api, auditInput, materialization, manifest);
      const first = await analyzeOnce(auditInput, materialization, hydrated);
      setStatus('Repeating deterministic manifest proof from the same verified payload set…', '');
      const secondProof = await manifestProof(hydrated.rows);
      const latestRuns = clone(auditInput.latestRuns || []);
      const secondTicketBasis = {
        namespaceUuid: latestRuns[0]?.namespace_uuid || '',
        migrationVersion: latestRuns[0]?.migration_version || '',
        cardMappingHash: latestRuns[0]?.card_mapping_hash || '',
        coreLibraryHash: latestRuns[0]?.core_library_hash || '',
        sourcePlanHash: materialization.sourcePlanHash || '',
        snapshotManifestHash: secondProof.snapshotManifestHash,
        tableManifestHashes: secondProof.tableManifestHashes,
        tableCounts: secondProof.counts
      };
      const secondTicketHash = await sha256(stableStringify(secondTicketBasis));
      const repeatability = first.cutoverTicketHash === secondTicketHash
        && first.proof.snapshotManifestHash === secondProof.snapshotManifestHash
        && stableStringify(first.proof.tableManifestHashes) === stableStringify(secondProof.tableManifestHashes)
        && stableStringify(first.proof.counts) === stableStringify(secondProof.counts);
      const pass = first.summary.pass && repeatability;

      state.report = {
        format: 'WLP_CANONICAL_CUTOVER_PREFLIGHT',
        version: 1,
        appVersion: APP_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'read-only-full-payload-hydration',
        compatibility: clone(materialization.compatibility || {}),
        latestRuns: clone(auditInput.latestRuns || []),
        sourcePlanHash: materialization.sourcePlanHash || null,
        sourceMaterializationHash: materialization.hashes?.snapshotManifestHash || null,
        cutoverTicketHash: first.cutoverTicketHash,
        hydration: {
          baseDevice: hydrated.baseRun?.device_key || '',
          baseRowsFetched: hydrated.baseRowsFetched,
          fallbackRowsFetched: hydrated.fallbackRowsFetched,
          unresolvedRows: hydrated.unresolved.length
        },
        summary: { ...first.summary, repeatability, pass },
        tableCounts: first.proof.counts,
        hashes: {
          snapshotManifestHash: first.proof.snapshotManifestHash,
          tableManifestHashes: first.proof.tableManifestHashes
        },
        referenceCounts: first.referenceCounts,
        issues: { blocking: first.blocking, warnings: first.warnings },
        invariants: {
          noCloudWrites: true,
          noCloudToWlpApply: true,
          noWlpWrites: true,
          noAutomaticCutover: true,
          noAbsenceBasedDeletion: true,
          fullFinalPayloadsHydrated: hydrated.rows.length === manifest.length,
          materializationManifestMatched: first.proof.snapshotManifestHash === materialization.hashes?.snapshotManifestHash
        }
      };
      state.hydratedRows = hydrated.rows;
      render(state.report);
      setStatus(
        `Canonical Cutover Preflight ${pass ? 'PASS' : 'CHECK'} · ${first.summary.hydratedRows.toLocaleString()} final payloads hydrated · ${first.summary.payloadHashesVerified.toLocaleString()} payload hashes verified · ${first.summary.blockingIssues} blocker(s) · ${first.summary.historicalWarnings} historical warning(s) · repeatability ${repeatability ? 'PASS' : 'FAIL'} · no Cloud/WLP data modified.`,
        pass ? 'success' : 'error'
      );
      window.dispatchEvent(new CustomEvent('wlp-canonical-cutover-preflight-complete'));
    } catch (error) {
      state.hydratedRows = null;
      console.error('WLP Canonical Cutover Preflight:', error);
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function render(report) {
    const s = report.summary;
    $('cutover-preflight-rows').textContent = Number(s.hydratedRows || 0).toLocaleString();
    $('cutover-preflight-hashes').textContent = Number(s.payloadHashesVerified || 0).toLocaleString();
    $('cutover-preflight-pk').textContent = Number(s.primaryKeysChecked || 0).toLocaleString();
    $('cutover-preflight-ref-blocking').textContent = Number(s.referenceBlocking || 0).toLocaleString();
    $('cutover-preflight-warnings').textContent = Number(s.historicalWarnings || 0).toLocaleString();
    $('cutover-preflight-repeat').textContent = s.repeatability ? 'PASS' : 'FAIL';
    $('cutover-preflight-result').textContent = s.pass ? 'PASS' : 'CHECK';
    $('cutover-preflight-result').className = s.pass ? 'compare-pass' : 'compare-check';
    $('cutover-preflight-manifest-hash').textContent = report.hashes?.snapshotManifestHash || '—';
    $('cutover-preflight-ticket-hash').textContent = report.cutoverTicketHash || '—';

    const tableBody = $('cutover-preflight-table-body');
    tableBody.innerHTML = '';
    const expected = window.WLPCanonicalMergeMaterialization?.getReport?.();
    Object.entries(report.tableCounts || {}).sort((a, b) => a[0].localeCompare(b[0])).forEach(([table, count]) => {
      const expectedCount = Number(expected?.tableCounts?.[table] || 0);
      const expectedHash = expected?.hashes?.tableManifestHashes?.[table] || '';
      const actualHash = report.hashes?.tableManifestHashes?.[table] || '';
      const tr = document.createElement('tr');
      [table, count, expectedCount, actualHash === expectedHash ? 'PASS' : 'CHECK'].forEach(value => {
        const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td);
      });
      tableBody.appendChild(tr);
    });

    const notes = $('cutover-preflight-notes');
    notes.innerHTML = '';
    const values = [
      ...(report.issues?.blocking || []).map(value => `BLOCKING · ${value}`),
      ...(report.issues?.warnings || []).map(value => `AUDIT · ${value}`)
    ];
    if (!values.length) values.push('No cutover-preflight issues detected.');
    values.forEach(value => { const li = document.createElement('li'); li.textContent = value; notes.appendChild(li); });

    $('cutover-preflight-panel').classList.remove('hidden');
    $('export-cutover-preflight').disabled = false;
  }

  function exportReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-cutover-preflight-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setStatus(message, kind) {
    const el = $('cutover-preflight-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-line${kind ? ` ${kind}` : ''}`;
  }
  function setBusy(value) { state.busy = Boolean(value); refreshButtons(); }
  function refreshButtons() {
    const materialization = window.WLPCanonicalMergeMaterialization?.getReport?.();
    $('run-cutover-preflight').disabled = state.busy || !materialization?.summary?.pass;
    $('export-cutover-preflight').disabled = state.busy || !state.report;
  }

  window.WLPCanonicalCutoverPreflight = Object.freeze({
    getReport: () => state.report,
    getVerifiedSnapshot: () => {
      if (!state.report?.summary?.pass || !Array.isArray(state.hydratedRows)) return null;
      if (state.hydratedRows.length !== Number(state.report.summary.hydratedRows || 0)) return null;
      return { report: state.report, rows: state.hydratedRows };
    }
  });

  function init() {
    $('run-cutover-preflight').addEventListener('click', runPreflight);
    $('export-cutover-preflight').addEventListener('click', exportReport);
    window.addEventListener('wlp-canonical-merge-materialization-complete', refreshButtons);
    window.addEventListener('focus', refreshButtons);
    setTimeout(refreshButtons, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
