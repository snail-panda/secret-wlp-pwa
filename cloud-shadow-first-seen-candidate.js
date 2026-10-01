/* WLP v1.8.6.216 — FirstSeen Preservation Authority v2 Candidate Commit + Round-trip.
   Builds the deterministic migration-v3 Authority revision from the verified local
   Canonical mirror plus both original source-stage learning_state snapshots, commits
   the FULL projected 21k-row snapshot into the existing INACTIVE candidate tables,
   then reads every row back and re-verifies identity, payload hashes and manifests.
   This step DOES write to isolated candidate tables. It does NOT advance the active
   Authority Head, rewrite wlp-cloud-v1, touch legacy localStorage, or change live WLP. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const APP_VERSION = '1.8.6.216-first-seen-authority-v2-candidate-v1';
  const CANDIDATE_SCHEMA_VERSION = 1;
  const TARGET_MIGRATION_VERSION = '3';
  const AUTHORITY_REVISION = 2;
  const EXPECTED_PARENT_MANIFEST = '2168a53454e664f98b3a986e978e557101a1be5256922143e2051b00317f705a';
  const EXPECTED_V2_MANIFEST = 'f2c8608ad317390b9ca61096210d246b4aff366a7109a81126917043b6e3c3a3';
  const EXPECTED_V2_LEARNING_STATE_MANIFEST = '67381bd1aeee1f79ded1041590aa89f2e1614f010eff3ab9d9d6a44841582ccc';
  const DB_NAME = 'wlp-cloud-v1';
  const DB_VERSION = 1;
  const META_STORE = 'sync_meta';
  const META_KEY = 'authority_mirror';
  const HASH_BATCH = 128;
  const UPLOAD_BATCH = 250;
  const CANONICAL_TABLES = Object.freeze([
    'cards','card_content','card_learning_metadata','learning_situations','learning_alternatives',
    'learning_alternative_situations','card_classification','learning_sessions','learning_events',
    'learning_state','learner_profile','learner_route_state','study_contexts','study_context_cards',
    'study_builds','study_build_cards','user_preferences'
  ]);
  const state = { busy: false, report: null, lastCandidateKey: '' };

  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const clean = value => String(value ?? '').trim();
  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach(key => { if (value[key] !== undefined) out[key] = stableValue(value[key]); });
      return out;
    }
    return value;
  }
  const stableStringify = value => JSON.stringify(stableValue(value));
  const identity = (tableName, rowKey) => `${tableName}\u0000${rowKey}`;
  function chunk(items, size) { const out=[]; for(let i=0;i<items.length;i+=size) out.push(items.slice(i,i+size)); return out; }
  function sleep(ms=0) { return new Promise(resolve => setTimeout(resolve, ms)); }
  async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value ?? '')));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
  }
  function toMs(value) {
    if (value === null || value === undefined || value === '') return 0;
    const number = Number(value);
    if (Number.isFinite(number) && String(value).trim() !== '') {
      if (number <= 0) return 0;
      return number < 100000000000 ? Math.round(number * 1000) : Math.round(number);
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  function iso(ms) { return ms > 0 ? new Date(ms).toISOString() : null; }
  function sameJSON(a,b) { return stableStringify(a ?? null) === stableStringify(b ?? null); }

  function requestPromise(request) {
    return new Promise((resolve,reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
  }
  function transactionDone(tx) {
    return new Promise((resolve,reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
    });
  }
  function openExistingMirror() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable.'));
    return new Promise((resolve,reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        try { request.transaction.abort(); } catch {}
        reject(new Error('wlp-cloud-v1 is not installed. Run the verified Canonical Mirror bootstrap first.'));
      };
      request.onsuccess = () => {
        const db = request.result;
        const missing = [...CANONICAL_TABLES, META_STORE].filter(name => !db.objectStoreNames.contains(name));
        if (missing.length) { db.close(); reject(new Error(`wlp-cloud-v1 schema mismatch: missing ${missing.join(', ')}.`)); return; }
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('Could not open wlp-cloud-v1.'));
      request.onblocked = () => reject(new Error('Opening wlp-cloud-v1 is blocked by another WLP tab.'));
    });
  }
  async function getAll(db, storeName) {
    const tx = db.transaction(storeName,'readonly');
    const rows = await requestPromise(tx.objectStore(storeName).getAll());
    await transactionDone(tx);
    return rows || [];
  }
  async function getMeta(db) {
    const tx = db.transaction(META_STORE,'readonly');
    const meta = await requestPromise(tx.objectStore(META_STORE).get(META_KEY));
    await transactionDone(tx);
    return meta || null;
  }
  async function readMirror(db) {
    const byTable = {}, rows = [];
    for (const tableName of CANONICAL_TABLES) {
      const tableRows = await getAll(db, tableName);
      byTable[tableName] = tableRows;
      tableRows.forEach(row => rows.push({
        tableName,
        rowKey: String(row.rowKey),
        payload: clone(row.payload),
        payloadHash: String(row.payloadHash),
        tombstone: Boolean(row.tombstone)
      }));
    }
    rows.sort((a,b) => identity(a.tableName,a.rowKey).localeCompare(identity(b.tableName,b.rowKey)));
    return { byTable, rows, meta: await getMeta(db) };
  }
  async function verifyPayloadHashes(rows) {
    let verified=0; const mismatches=[];
    for (let start=0; start<rows.length; start+=HASH_BATCH) {
      const batch=rows.slice(start,start+HASH_BATCH);
      const hashes=await Promise.all(batch.map(row => sha256(stableStringify(row.payload))));
      hashes.forEach((hash,index) => {
        const row=batch[index];
        if (hash === row.payloadHash) verified += 1;
        else mismatches.push(`${row.tableName}|${row.rowKey}: ${row.payloadHash} != ${hash}`);
      });
      if (start && start % (HASH_BATCH*8) === 0) await sleep(0);
    }
    return { verified, mismatches };
  }
  async function manifestProof(rows) {
    const fingerprints=[...rows].map(row => ({ tableName: row.tableName, rowKey: row.rowKey, tombstone:Boolean(row.tombstone), payloadHash:row.payloadHash }))
      .sort((a,b)=>identity(a.tableName,a.rowKey).localeCompare(identity(b.tableName,b.rowKey)));
    const tableCounts={}; fingerprints.forEach(row => { tableCounts[row.tableName]=(tableCounts[row.tableName]||0)+1; });
    const tableManifestHashes={};
    for (const tableName of Object.keys(tableCounts).sort()) {
      tableManifestHashes[tableName]=await sha256(stableStringify(fingerprints.filter(row => row.tableName===tableName)));
    }
    return { rowCount:fingerprints.length, snapshotManifestHash:await sha256(stableStringify(fingerprints)), tableCounts, tableManifestHashes };
  }

  function supabaseApi() {
    const api=window.WLPCloudShadowSupabase;
    if (!api?.ensureSession || !api?.registerDevice || !api?.rest || !api?.fetchPaged) throw new Error('Shadow Supabase transport is not ready. Reload Cloud Shadow.');
    return api;
  }
  async function fetchHead(api) {
    const rows=await api.fetchPaged('wlp_canonical_authority_heads',
      'head_schema_version,candidate_key,head_version,previous_candidate_key,cutover_ticket_hash,snapshot_manifest_hash,migration_version,namespace_uuid,card_mapping_hash,core_library_hash,canonical_row_count,promoted_by_device_key,promoted_at',
      'order=promoted_at.desc');
    if (rows.length !== 1) throw new Error(`Expected exactly one ACTIVE Authority Head, found ${rows.length}.`);
    return rows[0];
  }
  async function fetchCandidate(api,candidateKey) {
    const rows=await api.fetchPaged('wlp_canonical_authority_candidates',
      'candidate_key,candidate_schema_version,migration_version,namespace_uuid,app_version,status,committed_by_device_key,source_plan_hash,source_materialization_hash,cutover_ticket_hash,snapshot_manifest_hash,card_mapping_hash,core_library_hash,canonical_row_count,table_counts,table_manifest_hashes,source_devices,first_committed_at,last_committed_at,diagnostics',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}`);
    return rows[0] || null;
  }
  async function fetchSourceLearningState(api,source) {
    return api.fetchPaged('wlp_canonical_stage_records',
      'device_key,stage_key,table_name,row_key,payload_hash,tombstone,payload',
      `device_key=eq.${encodeURIComponent(source.device_key)}&stage_key=eq.${encodeURIComponent(source.stage_key)}&table_name=eq.learning_state&order=row_key.asc`);
  }
  function sourceFirstSeen(payload) {
    return toMs(payload?.first_seen_at ?? payload?.firstSeen ?? payload?.source_snapshot?.firstSeen ?? payload?.source_snapshot?.first_seen_at);
  }
  async function fetchCandidateRows(api,candidateKey) {
    return api.fetchPaged('wlp_canonical_authority_candidate_records',
      'candidate_key,table_name,row_key,payload_hash,tombstone,payload',
      `candidate_key=eq.${encodeURIComponent(candidateKey)}&order=table_name.asc,row_key.asc`);
  }
  async function exactCount(api,path) {
    const {data,response}=await api.rest(path,{headers:{Range:'0-0',Prefer:'count=exact'}});
    const range=response.headers.get('content-range')||'';
    const total=Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : (Array.isArray(data)?data.length:0);
  }
  async function countExisting(api,candidateKey) {
    const filter=`candidate_key=eq.${encodeURIComponent(candidateKey)}`;
    return {
      runCount: await exactCount(api,`wlp_canonical_authority_candidates?select=candidate_key&${filter}`),
      recordCount: await exactCount(api,`wlp_canonical_authority_candidate_records?select=row_key&${filter}`)
    };
  }

  async function buildProjectedInput(api,head,parentCandidate,mirror) {
    const blocking=[];
    const activeProof=await manifestProof(mirror.rows);
    const activePayloadCheck=await verifyPayloadHashes(mirror.rows);
    if (activePayloadCheck.mismatches.length) blocking.push(`${activePayloadCheck.mismatches.length} installed mirror payload hash mismatch(es).`);
    if (!mirror.meta) blocking.push('Canonical mirror metadata is missing.');
    if (head.candidate_key !== parentCandidate?.candidate_key) blocking.push('ACTIVE Head candidate key does not match parent candidate metadata.');
    if (head.snapshot_manifest_hash !== parentCandidate?.snapshot_manifest_hash) blocking.push('ACTIVE Head manifest does not match parent candidate metadata.');
    if (activeProof.snapshotManifestHash !== head.snapshot_manifest_hash) blocking.push('Installed mirror manifest does not match ACTIVE Authority Head.');
    if (activeProof.rowCount !== Number(head.canonical_row_count||0)) blocking.push('Installed mirror row count does not match ACTIVE Authority Head.');
    if (mirror.meta?.candidateKey !== head.candidate_key || mirror.meta?.snapshotManifestHash !== head.snapshot_manifest_hash) blocking.push('Installed mirror metadata does not match ACTIVE Authority Head.');
    if (!sameJSON(activeProof.tableCounts,parentCandidate?.table_counts||{})) blocking.push('Installed mirror table counts do not match ACTIVE candidate metadata.');
    if (!sameJSON(activeProof.tableManifestHashes,parentCandidate?.table_manifest_hashes||{})) blocking.push('Installed mirror table manifests do not match ACTIVE candidate metadata.');

    const sources=Array.isArray(parentCandidate?.source_devices) ? clone(parentCandidate.source_devices) : [];
    if (sources.length < 2) blocking.push(`Expected at least two source devices, found ${sources.length}.`);
    const evidenceByCard=new Map();
    const sourceAudit=[];
    for (const source of sources) {
      const sourceRows=await fetchSourceLearningState(api,source);
      const check=await verifyPayloadHashes(sourceRows.map(row => ({tableName:'learning_state',rowKey:String(row.row_key),payload:row.payload,payloadHash:String(row.payload_hash),tombstone:Boolean(row.tombstone)})));
      if (check.mismatches.length) blocking.push(`${check.mismatches.length} source-stage learning_state payload hash mismatch(es) for ${source.device_key}.`);
      sourceAudit.push({deviceKey:source.device_key,stageKey:source.stage_key,rows:sourceRows.length,payloadHashesVerified:check.verified,payloadHashMismatches:check.mismatches.length});
      sourceRows.forEach(row => {
        if (row.tombstone) return;
        const ms=sourceFirstSeen(row.payload);
        const key=String(row.row_key);
        const list=evidenceByCard.get(key)||[];
        if (ms>0) list.push({deviceKey:row.device_key,stageKey:row.stage_key,ms});
        evidenceByCard.set(key,list);
      });
    }

    const projectedRows=[];
    let changedRows=0, evidenceRows=0, disagreements=0;
    const missingEvidence=[];
    for (const row of mirror.rows) {
      if (row.tableName !== 'learning_state') { projectedRows.push(clone(row)); continue; }
      const evidence=(evidenceByCard.get(row.rowKey)||[]).filter(item=>item.ms>0);
      const unique=[...new Set(evidence.map(item=>item.ms))].sort((a,b)=>a-b);
      const selected=unique[0]||0;
      if (!selected) missingEvidence.push(row.rowKey); else evidenceRows += 1;
      if (unique.length>1) disagreements += 1;
      const payload=clone(row.payload||{});
      if (selected) payload.first_seen_at=iso(selected);
      const payloadHash=await sha256(stableStringify(payload));
      if (payloadHash !== row.payloadHash) changedRows += 1;
      projectedRows.push({tableName:row.tableName,rowKey:row.rowKey,payload,payloadHash,tombstone:Boolean(row.tombstone)});
    }
    projectedRows.sort((a,b)=>identity(a.tableName,a.rowKey).localeCompare(identity(b.tableName,b.rowKey)));
    if (missingEvidence.length) blocking.push(`${missingEvidence.length} ACTIVE learning_state row(s) have no non-zero source firstSeen evidence.`);
    const projectedProof=await manifestProof(projectedRows);
    if (projectedProof.rowCount !== activeProof.rowCount) blocking.push('Projected Authority row count changed unexpectedly.');
    if (changedRows && projectedProof.snapshotManifestHash === activeProof.snapshotManifestHash) blocking.push('Projected first_seen_at changes did not change the Authority manifest.');

    const repairPlan={
      kind:'first-seen-preservation',
      authorityRevision:AUTHORITY_REVISION,
      parentCandidateKey:head.candidate_key,
      parentHeadVersion:Number(head.head_version||0),
      parentManifestHash:head.snapshot_manifest_hash,
      targetMigrationVersion:TARGET_MIGRATION_VERSION,
      changedTable:'learning_state',
      changedRows,
      evidenceRows,
      sourceDevices:sources.map(source=>({deviceKey:source.device_key,stageKey:source.stage_key})).sort((a,b)=>a.deviceKey.localeCompare(b.deviceKey)),
      rule:'first_seen_at = earliest non-zero firstSeen evidence from verified source-stage learning_state rows',
      projectedManifestHash:projectedProof.snapshotManifestHash
    };
    const repairPlanHash=await sha256(stableStringify(repairPlan));
    const revisionTicketHash=await sha256(stableStringify({
      kind:'authority-revision-ticket',authorityRevision:AUTHORITY_REVISION,repairPlanHash,
      parentCandidateKey:head.candidate_key,parentHeadVersion:Number(head.head_version||0),
      parentManifestHash:head.snapshot_manifest_hash,projectedManifestHash:projectedProof.snapshotManifestHash,
      targetMigrationVersion:TARGET_MIGRATION_VERSION
    }));
    const candidateKey=`v${AUTHORITY_REVISION}:${revisionTicketHash}`;
    return {blocking,activeProof,activePayloadCheck,projectedRows,projectedProof,changedRows,evidenceRows,disagreements,missingEvidence,sourceAudit,sources,repairPlan,repairPlanHash,revisionTicketHash,candidateKey};
  }

  function checkExistingMeta(meta,input,head,parentCandidate,blocking) {
    if (!meta) return;
    if (meta.candidate_key !== input.candidateKey) blocking.push('Existing v2 candidate key mismatch.');
    if (Number(meta.candidate_schema_version||0) !== CANDIDATE_SCHEMA_VERSION) blocking.push('Existing v2 candidate schema version mismatch.');
    if (String(meta.migration_version||'') !== TARGET_MIGRATION_VERSION) blocking.push('Existing v2 candidate migration version mismatch.');
    if (meta.namespace_uuid !== head.namespace_uuid) blocking.push('Existing v2 candidate namespace UUID mismatch.');
    if (meta.card_mapping_hash !== head.card_mapping_hash) blocking.push('Existing v2 candidate Card Mapping Hash mismatch.');
    if (meta.core_library_hash !== head.core_library_hash) blocking.push('Existing v2 candidate Core Library Hash mismatch.');
    if (meta.source_plan_hash !== input.repairPlanHash) blocking.push('Existing v2 candidate repair-plan hash mismatch.');
    if (meta.source_materialization_hash !== head.snapshot_manifest_hash) blocking.push('Existing v2 candidate parent/source manifest mismatch.');
    if (meta.cutover_ticket_hash !== input.revisionTicketHash) blocking.push('Existing v2 candidate revision ticket mismatch.');
    if (meta.snapshot_manifest_hash !== input.projectedProof.snapshotManifestHash) blocking.push('Existing v2 candidate projected manifest mismatch.');
    if (Number(meta.canonical_row_count||0) !== input.projectedRows.length) blocking.push('Existing v2 candidate row-count mismatch.');
    if (!sameJSON(meta.table_counts||{},input.projectedProof.tableCounts)) blocking.push('Existing v2 candidate table-count mismatch.');
    if (!sameJSON(meta.table_manifest_hashes||{},input.projectedProof.tableManifestHashes)) blocking.push('Existing v2 candidate table-manifest mismatch.');
    if (!sameJSON(meta.source_devices||[],parentCandidate.source_devices||[])) blocking.push('Existing v2 candidate source-device provenance mismatch.');
  }
  async function checkExistingRows(api,candidateKey,expectedRows,blocking) {
    const existing=await fetchCandidateRows(api,candidateKey);
    if (!existing.length) return {rows:existing, exactExisting:0};
    const expected=new Map(expectedRows.map(row=>[identity(row.tableName,row.rowKey),row]));
    let exactExisting=0;
    for (const row of existing) {
      const key=identity(row.table_name,row.row_key), exp=expected.get(key);
      if (!exp) { blocking.push(`Existing v2 candidate contains unexpected row ${row.table_name}|${row.row_key}.`); continue; }
      if (String(row.payload_hash)!==exp.payloadHash || Boolean(row.tombstone)!==Boolean(exp.tombstone)) {
        blocking.push(`Existing v2 candidate row differs from content-addressed projection: ${row.table_name}|${row.row_key}.`);
      } else exactExisting += 1;
    }
    return {rows:existing,exactExisting};
  }

  async function upsertCandidate(api,session,device,input,head,parentCandidate,status,diagnostics={}) {
    const now=new Date().toISOString();
    await api.rest('wlp_canonical_authority_candidates?on_conflict=owner_id,candidate_key',{
      method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:[{
        owner_id:session.userId,
        candidate_key:input.candidateKey,
        candidate_schema_version:CANDIDATE_SCHEMA_VERSION,
        migration_version:TARGET_MIGRATION_VERSION,
        namespace_uuid:head.namespace_uuid,
        app_version:APP_VERSION,
        status,
        committed_by_device_key:device.deviceKey,
        source_plan_hash:input.repairPlanHash,
        source_materialization_hash:head.snapshot_manifest_hash,
        cutover_ticket_hash:input.revisionTicketHash,
        snapshot_manifest_hash:input.projectedProof.snapshotManifestHash,
        card_mapping_hash:head.card_mapping_hash,
        core_library_hash:head.core_library_hash,
        canonical_row_count:input.projectedRows.length,
        table_counts:input.projectedProof.tableCounts,
        table_manifest_hashes:input.projectedProof.tableManifestHashes,
        source_devices:clone(parentCandidate.source_devices||[]),
        diagnostics:{
          authorityRevision:AUTHORITY_REVISION,
          parentCandidateKey:head.candidate_key,
          parentHeadVersion:Number(head.head_version||0),
          parentManifestHash:head.snapshot_manifest_hash,
          repair:'explicit-first_seen_at',
          changedTable:'learning_state',
          changedRows:input.changedRows,
          firstSeenEvidenceRows:input.evidenceRows,
          sourceFirstSeenDisagreements:input.disagreements,
          projectedManifestHash:input.projectedProof.snapshotManifestHash,
          invariants:{inactiveCandidateOnly:true,noAuthorityHeadPromotion:true,noCloudToWlpApply:true,noLiveWlpWrites:true,noLocalMirrorWrites:true,noLegacyLocalStorageWrites:true},
          ...diagnostics
        },
        last_committed_at:now
      }]
    });
  }
  async function uploadRows(api,session,input) {
    const batches=chunk(input.projectedRows,UPLOAD_BATCH); let attempted=0;
    for (let i=0;i<batches.length;i+=1) {
      const now=new Date().toISOString();
      const body=batches[i].map(row=>({
        owner_id:session.userId,candidate_key:input.candidateKey,table_name:row.tableName,row_key:row.rowKey,
        payload:row.payload,payload_hash:row.payloadHash,tombstone:Boolean(row.tombstone),last_committed_at:now
      }));
      await api.rest('wlp_canonical_authority_candidate_records?on_conflict=owner_id,candidate_key,table_name,row_key',{
        method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body
      });
      attempted += body.length;
      setStatus(`Committing inactive Authority v2 Candidate… ${attempted.toLocaleString()} / ${input.projectedRows.length.toLocaleString()}`, '');
      if (i && i%8===0) await sleep(0);
    }
    return attempted;
  }

  async function verifyCloudRoundTrip(api,input,head,parentCandidate) {
    const blocking=[];
    const cloudRows=await fetchCandidateRows(api,input.candidateKey);
    const cloudMeta=await fetchCandidate(api,input.candidateKey);
    const expected=new Map(input.projectedRows.map(row=>[identity(row.tableName,row.rowKey),row]));
    const seen=new Set(); let payloadHashesVerified=0; const payloadHashMismatches=[]; const identityMismatches=[];
    for (let start=0;start<cloudRows.length;start+=HASH_BATCH) {
      const batch=cloudRows.slice(start,start+HASH_BATCH);
      const hashes=await Promise.all(batch.map(row=>sha256(stableStringify(row.payload))));
      hashes.forEach((hash,index)=>{
        const row=batch[index], key=identity(row.table_name,row.row_key), exp=expected.get(key); seen.add(key);
        if (hash === row.payload_hash) payloadHashesVerified += 1; else payloadHashMismatches.push(key);
        if (!exp || exp.payloadHash!==row.payload_hash || Boolean(exp.tombstone)!==Boolean(row.tombstone)) identityMismatches.push(key);
      });
    }
    const missing=[...expected.keys()].filter(key=>!seen.has(key));
    const extras=cloudRows.filter(row=>!expected.has(identity(row.table_name,row.row_key)));
    if (payloadHashMismatches.length) blocking.push(`${payloadHashMismatches.length} candidate payload hash mismatch(es).`);
    if (identityMismatches.length) blocking.push(`${identityMismatches.length} candidate identity/fingerprint mismatch(es).`);
    if (missing.length) blocking.push(`${missing.length} projected row(s) missing from candidate.`);
    if (extras.length) blocking.push(`${extras.length} extra row(s) found in candidate.`);
    const cloudNorm=cloudRows.map(row=>({tableName:row.table_name,rowKey:row.row_key,payload:row.payload,payloadHash:row.payload_hash,tombstone:Boolean(row.tombstone)}));
    const proof=await manifestProof(cloudNorm);
    if (proof.snapshotManifestHash!==input.projectedProof.snapshotManifestHash) blocking.push('Candidate read-back manifest does not match projected Authority v2 manifest.');
    if (!sameJSON(proof.tableCounts,input.projectedProof.tableCounts)) blocking.push('Candidate read-back table counts do not match projection.');
    if (!sameJSON(proof.tableManifestHashes,input.projectedProof.tableManifestHashes)) blocking.push('Candidate read-back table manifests do not match projection.');
    checkExistingMeta(cloudMeta,input,head,parentCandidate,blocking);
    return {blocking,cloudRows,cloudMeta,proof,payloadHashesVerified,payloadHashMismatches:payloadHashMismatches.length,identityMismatches:identityMismatches.length,missingRows:missing.length,extraRows:extras.length};
  }

  async function commit(retryOnly=false) {
    if (state.busy) return;
    setBusy(true); setStatus(retryOnly?'Retrying the same inactive Authority v2 Candidate…':'Building the deterministic Authority v2 FirstSeen repair candidate…','');
    let db=null,api=null,session=null,device=null,input=null,head=null,parentCandidate=null;
    try {
      api=supabaseApi(); session=await api.ensureSession(); device=await api.registerDevice();
      head=await fetchHead(api); parentCandidate=await fetchCandidate(api,head.candidate_key);
      if (!parentCandidate || parentCandidate.status!=='verified') throw new Error('ACTIVE parent candidate is missing or not verified.');
      if (Number(head.head_version||0)!==1) throw new Error(`Authority v2 candidate expects parent Head version 1, found ${head.head_version}.`);
      db=await openExistingMirror(); const mirror=await readMirror(db);
      input=await buildProjectedInput(api,head,parentCandidate,mirror);
      if (input.blocking.length) throw new Error(`Authority v2 candidate blocked before Cloud write: ${input.blocking.join(' ')}`);
      if (head.snapshot_manifest_hash!==EXPECTED_PARENT_MANIFEST) throw new Error(`Authority v2 candidate expects the verified v1 parent manifest ${EXPECTED_PARENT_MANIFEST}, found ${head.snapshot_manifest_hash}.`);
      if (input.changedRows!==111) throw new Error(`Expected 111 learning_state rows to gain explicit first_seen_at, found ${input.changedRows}.`);
      if (input.evidenceRows!==111) throw new Error(`Expected source firstSeen evidence for all 111 learning_state rows, found ${input.evidenceRows}.`);
      if (input.disagreements!==0) throw new Error(`Expected zero cross-device firstSeen disagreements from v215 preflight, found ${input.disagreements}.`);
      if (input.projectedProof.snapshotManifestHash!==EXPECTED_V2_MANIFEST) throw new Error(`Projected Authority v2 manifest drifted from the verified v215 preflight: ${input.projectedProof.snapshotManifestHash}.`);
      if (input.projectedProof.tableManifestHashes.learning_state!==EXPECTED_V2_LEARNING_STATE_MANIFEST) throw new Error('Projected learning_state manifest drifted from the verified v215 preflight.');
      if (retryOnly && state.lastCandidateKey && state.lastCandidateKey!==input.candidateKey) throw new Error('Retry blocked: deterministic Authority v2 candidate key changed.');

      const before=await countExisting(api,input.candidateKey);
      const existingMeta=await fetchCandidate(api,input.candidateKey);
      const prewriteBlocking=[];
      checkExistingMeta(existingMeta,input,head,parentCandidate,prewriteBlocking);
      const existingCheck=await checkExistingRows(api,input.candidateKey,input.projectedRows,prewriteBlocking);
      if (prewriteBlocking.length) throw new Error(`Content-addressed retry safety blocked write: ${prewriteBlocking.join(' ')}`);
      if (retryOnly && before.runCount!==1) throw new Error('Retry blocked: Authority v2 candidate metadata does not already exist.');

      await upsertCandidate(api,session,device,input,head,parentCandidate,'started',{retryRequested:retryOnly,preexistingExactRows:existingCheck.exactExisting});
      const attempted=await uploadRows(api,session,input);
      await upsertCandidate(api,session,device,input,head,parentCandidate,'uploaded',{retryRequested:retryOnly,uploadAttemptedRows:attempted,preexistingExactRows:existingCheck.exactExisting});
      const verification=await verifyCloudRoundTrip(api,input,head,parentCandidate);
      const after=await countExisting(api,input.candidateKey);
      const retryIdempotent=retryOnly ? (before.runCount===1 && after.runCount===1 && before.recordCount===after.recordCount && after.recordCount===input.projectedRows.length) : null;
      if (retryOnly && !retryIdempotent) verification.blocking.push('Retry idempotency check did not pass.');
      const pass=verification.blocking.length===0 && (!retryOnly || retryIdempotent===true);
      await upsertCandidate(api,session,device,input,head,parentCandidate,pass?'verified':'failed',{
        retryRequested:retryOnly,retryIdempotent,uploadAttemptedRows:attempted,readBackRows:verification.cloudRows.length,
        payloadHashesVerified:verification.payloadHashesVerified,payloadHashMismatches:verification.payloadHashMismatches,
        identityMismatches:verification.identityMismatches,manifestHash:verification.proof.snapshotManifestHash,blockers:verification.blocking
      });
      const finalMeta=await fetchCandidate(api,input.candidateKey);
      if (pass && finalMeta?.status!=='verified') verification.blocking.push('Authority v2 candidate status did not persist as verified.');
      const finalPass=pass && verification.blocking.length===0;
      state.lastCandidateKey=input.candidateKey;
      state.report={
        format:'WLP_CANONICAL_AUTHORITY_V2_FIRST_SEEN_CANDIDATE',version:1,appVersion:APP_VERSION,generatedAt:new Date().toISOString(),
        mode:retryOnly?'retry-inactive-authority-v2-candidate':'commit-inactive-authority-v2-candidate',
        candidateKey:input.candidateKey,authorityRevision:AUTHORITY_REVISION,revisionTicketHash:input.revisionTicketHash,repairPlanHash:input.repairPlanHash,
        parent:{candidateKey:head.candidate_key,headVersion:Number(head.head_version||0),manifestHash:head.snapshot_manifest_hash,migrationVersion:String(head.migration_version||'')},
        projected:{migrationVersion:TARGET_MIGRATION_VERSION,manifestHash:input.projectedProof.snapshotManifestHash,canonicalRows:input.projectedRows.length,changedLearningStateRows:input.changedRows,firstSeenEvidenceRows:input.evidenceRows,sourceFirstSeenDisagreements:input.disagreements},
        summary:{expectedRows:input.projectedRows.length,readBackRows:verification.cloudRows.length,payloadHashesVerified:verification.payloadHashesVerified,payloadHashMismatches:verification.payloadHashMismatches,identityMismatches:verification.identityMismatches,missingRows:verification.missingRows,extraRows:verification.extraRows,blockingIssues:verification.blocking.length,tombstoneRows:verification.cloudRows.filter(row=>row.tombstone).length,retryRequested:retryOnly,retryIdempotent,candidateStatus:finalMeta?.status||'',pass:finalPass},
        counts:{before,after},sourceAudit:input.sourceAudit,tableCounts:verification.proof.tableCounts,
        hashes:{parentManifestHash:head.snapshot_manifest_hash,projectedManifestHash:verification.proof.snapshotManifestHash,tableManifestHashes:verification.proof.tableManifestHashes},
        issues:{blocking:verification.blocking,warnings:[
          'Authority v2 Candidate is inactive. The ACTIVE Head remains on Authority v1 until a separate promotion preflight and explicit promotion step.',
          'Only learning_state payloads change: all 111 state rows gain explicit first_seen_at; every other Canonical row is byte-semantically unchanged.',
          'Cloud writes are restricted to the existing inactive candidate tables. wlp-cloud-v1, localStorage, Progress, Review, Study, Editor, and the active Authority Head are untouched.',
          ...(verification.cloudRows.some(row=>row.tombstone)?[]:['No explicit tombstones exist in current real data; tombstone behavior remains unexercised.'])
        ]},
        invariants:{cloudWritesRestrictedToInactiveCandidateTables:true,noAuthorityHeadPromotion:true,activeHeadRemainsV1:true,noCanonicalMirrorWrites:true,noLegacyLocalStorageWrites:true,noLiveWlpWrites:true,contentAddressedCandidateKey:true,parentAuthorityReverified:true,sourceStagePayloadHashesVerified:input.sourceAudit.every(x=>x.payloadHashMismatches===0),fullPayloadRoundTripVerified:verification.payloadHashesVerified===input.projectedRows.length&&verification.payloadHashMismatches===0,projectedRowCountUnchanged:input.projectedRows.length===Number(head.canonical_row_count||0),onlyLearningStateSemanticallyChanged:true}
      };
      render(state.report);
      setStatus(finalPass
        ? `Inactive Authority v2 Candidate PASS · ${verification.cloudRows.length.toLocaleString()} rows read back · 111 first_seen_at repairs · manifest ${verification.proof.snapshotManifestHash.slice(0,12)}…${retryOnly?' · retry idempotency PASS':''} · ACTIVE Head still v1.`
        : `Authority v2 Candidate completed with ${verification.blocking.length} blocker(s). ACTIVE Head was not changed.`, finalPass?'success':'error');
    } catch (error) {
      console.error('WLP Authority v2 FirstSeen Candidate:',error);
      if (api&&session&&device&&input&&head&&parentCandidate) {
        try { await upsertCandidate(api,session,device,input,head,parentCandidate,'failed',{error:error?.message||String(error)}); } catch {}
      }
      setStatus(error?.message||String(error),'error');
    } finally { try{db?.close();}catch{} setBusy(false); }
  }

  function render(report) {
    const s=report.summary||{};
    $('first-seen-candidate-rows').textContent=Number(s.readBackRows||0).toLocaleString();
    $('first-seen-candidate-hashes').textContent=Number(s.payloadHashesVerified||0).toLocaleString();
    $('first-seen-candidate-mismatches').textContent=Number(s.payloadHashMismatches||0).toLocaleString();
    $('first-seen-candidate-changed').textContent=Number(report.projected?.changedLearningStateRows||0).toLocaleString();
    $('first-seen-candidate-blocking').textContent=Number(s.blockingIssues||0).toLocaleString();
    $('first-seen-candidate-retry').textContent=s.retryRequested?(s.retryIdempotent?'PASS':'FAIL'):'—';
    $('first-seen-candidate-result').textContent=s.pass?'PASS':'CHECK';
    $('first-seen-candidate-result').className=s.pass?'compare-pass':'compare-check';
    $('first-seen-candidate-key').textContent=report.candidateKey||'—';
    $('first-seen-candidate-ticket').textContent=report.revisionTicketHash||'—';
    $('first-seen-candidate-manifest').textContent=report.hashes?.projectedManifestHash||'—';
    const body=$('first-seen-candidate-table-body'); body.innerHTML='';
    Object.entries(report.tableCounts||{}).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([table,count])=>{
      const tr=document.createElement('tr');
      [table,count,table==='learning_state'?'payloads updated':'unchanged from parent',report.hashes?.tableManifestHashes?.[table]||''].forEach((value,index)=>{const td=document.createElement('td');td.textContent=String(value);if(index===3)td.style.wordBreak='break-all';tr.appendChild(td);});
      body.appendChild(tr);
    });
    const notes=$('first-seen-candidate-notes'); notes.innerHTML='';
    const values=[...(report.issues?.blocking||[]).map(v=>`BLOCKING · ${v}`),...(report.issues?.warnings||[]).map(v=>`AUDIT · ${v}`)];
    if(!values.length) values.push('No Authority v2 Candidate issues detected.');
    values.forEach(value=>{const li=document.createElement('li');li.textContent=value;notes.appendChild(li);});
    $('first-seen-candidate-panel').classList.remove('hidden'); $('export-first-seen-candidate').disabled=false;
  }
  function exportReport() {
    if(!state.report)return; const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`wlp-canonical-authority-v2-first-seen-candidate-${state.report.generatedAt.replace(/[:.]/g,'-')}.json`; document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  function setStatus(message,kind){const el=$('first-seen-candidate-status');if(!el)return;el.textContent=message;el.className=`status-line${kind?` ${kind}`:''}`;}
  function setBusy(busy){state.busy=Boolean(busy);refreshButtons();}
  function refreshButtons(){const run=$('commit-first-seen-candidate'),retry=$('retry-first-seen-candidate'),exp=$('export-first-seen-candidate');if(run)run.disabled=state.busy;if(retry)retry.disabled=state.busy||!state.report?.summary?.pass;if(exp)exp.disabled=state.busy||!state.report;}
  function init(){
    $('commit-first-seen-candidate')?.addEventListener('click',()=>commit(false));
    $('retry-first-seen-candidate')?.addEventListener('click',()=>commit(true));
    $('export-first-seen-candidate')?.addEventListener('click',exportReport);
    refreshButtons();
  }
  window.WLPCanonicalFirstSeenAuthorityV2Candidate=Object.freeze({getReport:()=>clone(state.report)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
