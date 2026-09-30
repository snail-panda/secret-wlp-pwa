/* WLP Canonical Card Identity Dry Run v1.
   Read-only: derives deterministic UUIDv5 card IDs from the current Shadow scan.
   No WLP storage, Shadow IndexedDB, or Supabase rows are modified. */
(() => {
  'use strict';

  const IDENTITY_VERSION = 1;
  const CARD_NAMESPACE_UUID = '87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const state = { report: null };
  const $ = id => document.getElementById(id);

  function utf8Bytes(value) {
    return new TextEncoder().encode(String(value ?? ''));
  }

  function uuidToBytes(value) {
    const hex = String(value || '').replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error('Invalid canonical UUID namespace.');
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function bytesToUuid(bytes) {
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  async function digest(algorithm, bytes) {
    const result = await crypto.subtle.digest(algorithm, bytes);
    return new Uint8Array(result);
  }

  async function sha256(value) {
    const bytes = await digest('SHA-256', utf8Bytes(value));
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  async function uuidV5(namespaceUuid, name) {
    const namespace = uuidToBytes(namespaceUuid);
    const nameBytes = utf8Bytes(name);
    const input = new Uint8Array(namespace.length + nameBytes.length);
    input.set(namespace, 0);
    input.set(nameBytes, namespace.length);
    const hash = await digest('SHA-1', input);
    const bytes = hash.slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytesToUuid(bytes);
  }

  function validCardKey(value) {
    return /^(?:wid:[^\s]+|draft:.+)$/.test(String(value || ''));
  }

  function validUuidV5(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  }

  async function buildMapping(cardRecords) {
    const mapping = [];
    for (const record of cardRecords) {
      const legacyKey = String(record.entityKey || '');
      const cardId = await uuidV5(CARD_NAMESPACE_UUID, `card|${legacyKey}`);
      mapping.push({
        legacyKey,
        cardId,
        wordId: record.payload?.wordId ?? null,
        status: record.payload?.status || '',
        originKind: record.payload?.originKind || '',
        source: record.source || ''
      });
    }
    mapping.sort((a, b) => a.legacyKey.localeCompare(b.legacyKey));
    return mapping;
  }

  function render(report) {
    $('identity-card-count').textContent = report.summary.mappedCards.toLocaleString();
    $('identity-unique-count').textContent = report.summary.uniqueCardIds.toLocaleString();
    $('identity-errors-count').textContent = String(report.summary.errors);
    $('identity-rerun').textContent = report.summary.rerunStable ? 'PASS' : 'CHECK';
    $('identity-namespace').textContent = report.namespaceUuid;
    $('identity-mapping-hash').textContent = report.mappingHash;
    $('identity-source-hash').textContent = report.sourceSnapshotHash || '—';
    $('identity-status').className = `status-line ${report.summary.errors ? 'error' : 'success'}`;
    $('identity-status').textContent = report.summary.errors
      ? `Identity dry run completed with ${report.summary.errors} issue${report.summary.errors === 1 ? '' : 's'}. Do not persist this mapping.`
      : `Identity dry run PASS · ${report.summary.mappedCards.toLocaleString()} cards mapped · no duplicate UUIDs · no WLP or Cloud data modified.`;
    $('identity-panel').classList.remove('hidden');
    $('export-identity').disabled = false;
  }

  async function runIdentityDryRun() {
    const snapshot = window.WLPCloudShadow?.getLatestSnapshot?.();
    if (!snapshot || !Array.isArray(snapshot.records)) throw new Error('Run Local Scan first.');

    const button = $('run-identity');
    button.disabled = true;
    $('export-identity').disabled = true;
    $('identity-status').className = 'status-line';
    $('identity-status').textContent = 'Deriving deterministic UUIDv5 Card IDs locally…';
    $('identity-panel').classList.remove('hidden');

    try {
      const cardRecords = snapshot.records.filter(record => record?.entityType === 'card');
      const invalidLegacyKeys = cardRecords.filter(record => !validCardKey(record.entityKey)).map(record => String(record.entityKey || ''));
      const mapping = await buildMapping(cardRecords);
      const rerun = await buildMapping(cardRecords);
      const legacyKeys = mapping.map(item => item.legacyKey);
      const cardIds = mapping.map(item => item.cardId);
      const duplicateLegacyKeys = legacyKeys.length - new Set(legacyKeys).size;
      const duplicateCardIds = cardIds.length - new Set(cardIds).size;
      const invalidCardIds = mapping.filter(item => !validUuidV5(item.cardId)).map(item => item.cardId);
      const rerunStable = mapping.length === rerun.length && mapping.every((item, index) => item.legacyKey === rerun[index].legacyKey && item.cardId === rerun[index].cardId);
      const mappingHash = await sha256(mapping.map(item => `${item.legacyKey}|${item.cardId}`).join('\n'));
      const statusCounts = mapping.reduce((out, item) => {
        const key = item.status || 'unknown';
        out[key] = (out[key] || 0) + 1;
        return out;
      }, {});
      const errors = invalidLegacyKeys.length + duplicateLegacyKeys + duplicateCardIds + invalidCardIds.length + (rerunStable ? 0 : 1);

      state.report = {
        format: 'WLP_CANONICAL_CARD_IDENTITY_DRY_RUN',
        version: 1,
        identityVersion: IDENTITY_VERSION,
        generatedAt: new Date().toISOString(),
        algorithm: 'UUIDv5 namespace-name mapping (SHA-1 per RFC UUIDv5); SHA-256 audit hash',
        namespaceUuid: CARD_NAMESPACE_UUID,
        nameRule: 'card|<legacyKey>',
        sourceSnapshotHash: snapshot.report?.snapshotHash || '',
        sourceMasterSha256: snapshot.report?.master?.sha256 || '',
        summary: {
          sourceCardRecords: cardRecords.length,
          mappedCards: mapping.length,
          uniqueLegacyKeys: new Set(legacyKeys).size,
          uniqueCardIds: new Set(cardIds).size,
          duplicateLegacyKeys,
          duplicateCardIds,
          invalidLegacyKeys: invalidLegacyKeys.length,
          invalidCardIds: invalidCardIds.length,
          rerunStable,
          errors,
          statusCounts
        },
        mappingHash,
        invariants: {
          noWlpWrites: true,
          noShadowIndexedDbWrites: true,
          noCloudReads: true,
          noCloudWrites: true,
          namespaceMustNeverChangeAfterCanonicalCutover: true
        },
        issues: {
          invalidLegacyKeys,
          invalidCardIds
        },
        cards: mapping
      };

      render(state.report);
    } catch (error) {
      console.error('WLP Canonical Identity dry run failed:', error);
      $('identity-status').className = 'status-line error';
      $('identity-status').textContent = error?.message || String(error);
    } finally {
      button.disabled = false;
    }
  }

  function exportIdentityReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-card-identity-dry-run-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function refreshButton() {
    const snapshot = window.WLPCloudShadow?.getLatestSnapshot?.();
    $('run-identity').disabled = !snapshot;
  }

  function handleScanComplete() {
    state.report = null;
    $('export-identity').disabled = true;
    if (!$('identity-panel').classList.contains('hidden')) {
      $('identity-status').className = 'status-line';
      $('identity-status').textContent = 'Local snapshot refreshed. Run the Card-ID dry run again before using or exporting the mapping.';
    }
    refreshButton();
  }

  function init() {
    $('run-identity').addEventListener('click', runIdentityDryRun);
    $('export-identity').addEventListener('click', exportIdentityReport);
    window.addEventListener('wlp-cloud-shadow-scan-complete', handleScanComplete);
    refreshButton();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
