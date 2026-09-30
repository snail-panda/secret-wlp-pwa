/* WLP Canonical Migration Dry Run v1.
   Read-only structural migration from the current Shadow logical snapshot into
   the planned Cloud Schema v1 shape. No WLP storage, Shadow IndexedDB, or
   Supabase rows are modified. */
(() => {
  'use strict';

  const MIGRATION_VERSION = 1;
  const CANONICAL_NAMESPACE_UUID = '87dc20ed-dd35-5ba3-8bde-04bf389874ce';
  const state = { report: null };
  const $ = id => document.getElementById(id);
  const clean = value => String(value ?? '').trim();

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
  function utf8Bytes(value) { return new TextEncoder().encode(String(value ?? '')); }

  async function digest(algorithm, bytes) {
    const result = await crypto.subtle.digest(algorithm, bytes);
    return new Uint8Array(result);
  }

  async function sha256(value) {
    const bytes = await digest('SHA-256', utf8Bytes(value));
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
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

  async function uuidV5(name) {
    const namespace = uuidToBytes(CANONICAL_NAMESPACE_UUID);
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

  function asArray(value) { return Array.isArray(value) ? value : []; }
  function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  function nullable(value) { const text = clean(value); return text || null; }
  function numeric(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function isoTime(value) {
    if (value === null || value === undefined || value === '') return null;
    const raw = Number(value);
    const date = Number.isFinite(raw) && String(value).trim() !== ''
      ? new Date(raw > 0 && raw < 100000000000 ? raw * 1000 : raw)
      : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function sourceId(value, keys) {
    const obj = asObject(value);
    for (const key of keys) {
      const text = clean(obj[key]);
      if (text) return text;
    }
    return '';
  }

  function firstWordId(value) {
    const obj = asObject(value);
    const candidates = [
      obj.wordId, obj.wordID, obj.word_id, obj.wid, obj.cardWordId, obj.targetWordId,
      obj.card?.wordId, obj.card?.wordID, obj.target?.wordId, obj.target?.wordID,
      obj.result?.wordId, obj.route?.wordId, obj.context?.wordId
    ];
    for (const candidate of candidates) {
      const text = clean(candidate);
      if (text) return text;
    }
    return '';
  }

  function firstSessionId(value) {
    const obj = asObject(value);
    const candidates = [
      obj.sessionId, obj.session_id, obj.session?.sessionId, obj.session?.id,
      obj.sessionRef?.sessionId, obj.context?.sessionId
    ];
    for (const candidate of candidates) {
      const text = clean(candidate);
      if (text) return text;
    }
    return '';
  }

  function eventTime(event) {
    const obj = asObject(event);
    return isoTime(obj.occurredAt ?? obj.occurred_at ?? obj.timestamp ?? obj.createdAt ?? obj.created_at ?? obj.at ?? obj.updatedAt);
  }

  function preferenceSection(key) {
    const value = clean(key);
    if (value === 'wlp:settings:general:v1') return 'general';
    if (/review/i.test(value)) return 'review';
    if (/progress/i.test(value)) return 'progress';
    if (/ai-study|studyq|practice-mode/i.test(value)) return 'practice';
    return 'study';
  }

  function tablePrimaryKey(table, row) {
    const keys = {
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
    };
    return keys[table]?.(row) || '';
  }

  async function buildCanonical(snapshot) {
    const records = asArray(snapshot.records);
    const byType = new Map();
    records.forEach(record => {
      const type = clean(record?.entityType);
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(record);
    });

    const tables = {
      cards: [], card_content: [], card_learning_metadata: [], learning_situations: [],
      learning_alternatives: [], learning_alternative_situations: [], card_classification: [],
      learning_sessions: [], learning_events: [], learning_state: [], learner_profile: [],
      learner_route_state: [], study_contexts: [], study_context_cards: [], study_builds: [],
      study_build_cards: [], user_link_categories: [], user_links: [], user_preferences: []
    };
    const blocking = [];
    const warnings = [];
    const consumed = new Set();
    const cardMap = new Map();
    const sessionSourceMap = new Map();
    const audit = {
      missingEventCards: new Map(),
      missingEventSessions: new Map(),
      missingContextCards: new Map(),
      missingContextSessions: new Map(),
      missingBuildCards: new Map()
    };
    const bump = (map, key) => { if (key) map.set(key, (map.get(key) || 0) + 1); };
    const sourceMasterHash = clean(snapshot.report?.master?.sha256);

    for (const record of byType.get('card') || []) {
      const legacyKey = clean(record.entityKey);
      const cardId = await uuidV5(`card|${legacyKey}`);
      if (!legacyKey) { blocking.push('Card record with empty legacy key.'); continue; }
      if (cardMap.has(legacyKey)) blocking.push(`Duplicate Card legacy key: ${legacyKey}`);
      cardMap.set(legacyKey, cardId);
      const payload = asObject(record.payload);
      tables.cards.push({
        card_id: cardId,
        legacy_key: legacyKey,
        word_id: numeric(payload.wordId),
        status: clean(payload.status) || 'active',
        origin_kind: clean(payload.originKind) || (legacyKey.startsWith('draft:') ? 'personal' : 'official'),
        origin_ref: nullable(payload.originRef),
        legacy_batch: numeric(payload.legacyBatch),
        legacy_guidance: nullable(payload.legacyGuidance),
        order_key: String(tables.cards.length + 1).padStart(8, '0'),
        official_base_hash: legacyKey.startsWith('wid:') ? (sourceMasterHash || null) : null,
        row_version: 1,
        created_at: isoTime(payload.createdAt),
        updated_at: isoTime(payload.updatedAt),
        created_by_device: null,
        updated_by_device: null,
        deleted_at: record.tombstone ? (isoTime(payload.deletedAt) || 'TOMBSTONE_PRESENT') : null
      });
      consumed.add(record);
    }

    for (const record of byType.get('card_content') || []) {
      const cardId = cardMap.get(clean(record.entityKey));
      if (!cardId) { blocking.push(`Card Content without matching Card: ${record.entityKey}`); continue; }
      const p = asObject(record.payload);
      tables.card_content.push({
        card_id: cardId,
        word: String(p.Word ?? ''),
        ipa: String(p.IPA ?? ''),
        part_of_speech: String(p['Part of Speech'] ?? ''),
        definition: String(p.Definition ?? ''),
        synonyms: String(p['Synonym(s)'] ?? ''),
        example_sentence: String(p['Example Sentence'] ?? ''),
        notes: String(p['Note(s)'] ?? ''),
        category: String(p.Category ?? ''),
        source: String(p.Source ?? ''),
        field_meta: {},
        row_version: 1,
        updated_at: null,
        updated_by_device: null,
        migration_source: clean(record.source) || null,
        source_payload_hash: clean(record.payloadHash) || null
      });
      consumed.add(record);
    }

    const situationSourceMap = new Map();
    for (const record of byType.get('card_learning_metadata') || []) {
      const cardId = cardMap.get(clean(record.entityKey));
      if (!cardId) { blocking.push(`Learning Metadata without matching Card: ${record.entityKey}`); continue; }
      const p = asObject(record.payload);
      const content = asObject(p.content);
      tables.card_learning_metadata.push({
        card_id: cardId,
        metadata_id: nullable(p.metadataId),
        entry_type: String(content.entryType ?? ''),
        sense_hook: String(content.senseHook ?? ''),
        memory_hook: String(content.memoryHook ?? ''),
        status: nullable(p.status),
        revision: numeric(p.revision) || 1,
        version_id: nullable(p.versionId),
        parent_version_id: nullable(p.parentVersionId),
        created_at: isoTime(p.createdAt),
        updated_at: isoTime(p.updatedAt),
        created_by_device: nullable(p.createdByDevice),
        updated_by_device: nullable(p.updatedByDevice),
        deleted_at: isoTime(p.deletedAt),
        field_meta: {},
        source_history: asArray(p.history)
      });

      const situations = asArray(content.situations);
      for (let ordinal = 0; ordinal < situations.length; ordinal += 1) {
        const s = asObject(situations[ordinal]);
        const sourceSituationId = clean(s.situationId) || `index:${ordinal}:${await sha256(stableStringify(s))}`;
        const situationId = await uuidV5(`situation|${record.entityKey}|${sourceSituationId}`);
        situationSourceMap.set(`${record.entityKey}|${sourceSituationId}`, situationId);
        tables.learning_situations.push({
          situation_id: situationId,
          source_situation_id: sourceSituationId,
          card_id: cardId,
          title: String(s.title ?? ''),
          anchor: String(s.anchor ?? ''),
          communicative_need: String(s.communicativeNeed ?? ''),
          status: nullable(s.status),
          revision: numeric(s.revision) || 1,
          version_id: nullable(s.versionId),
          parent_version_id: nullable(s.parentVersionId),
          ordinal,
          created_at: isoTime(s.createdAt),
          updated_at: isoTime(s.updatedAt),
          created_by_device: nullable(s.createdByDevice),
          updated_by_device: nullable(s.updatedByDevice),
          deleted_at: isoTime(s.deletedAt),
          source_history: asArray(s.history)
        });
      }

      const alternatives = asArray(content.alternativeExpressions);
      for (let ordinal = 0; ordinal < alternatives.length; ordinal += 1) {
        const a = asObject(alternatives[ordinal]);
        const sourceAlternativeId = clean(a.alternativeId) || `index:${ordinal}:${await sha256(stableStringify(a))}`;
        const alternativeId = await uuidV5(`alternative|${record.entityKey}|${sourceAlternativeId}`);
        tables.learning_alternatives.push({
          alternative_id: alternativeId,
          source_alternative_id: sourceAlternativeId,
          card_id: cardId,
          expression: String(a.expression ?? ''),
          notes: String(a.note ?? a.notes ?? ''),
          status: nullable(a.status),
          revision: numeric(a.revision) || 1,
          version_id: nullable(a.versionId),
          parent_version_id: nullable(a.parentVersionId),
          ordinal,
          created_at: isoTime(a.createdAt),
          updated_at: isoTime(a.updatedAt),
          updated_by_device: nullable(a.updatedByDevice),
          deleted_at: isoTime(a.deletedAt),
          source_history: asArray(a.history)
        });
        for (const sourceSituationId of asArray(a.situationIds).map(clean).filter(Boolean)) {
          const situationId = situationSourceMap.get(`${record.entityKey}|${sourceSituationId}`);
          if (!situationId) {
            blocking.push(`Alternative ${sourceAlternativeId} references missing Situation ${sourceSituationId} on ${record.entityKey}.`);
            continue;
          }
          tables.learning_alternative_situations.push({ alternative_id: alternativeId, situation_id: situationId, created_at: isoTime(a.createdAt), deleted_at: isoTime(a.deletedAt) });
        }
      }
      consumed.add(record);
    }

    for (const record of byType.get('card_classification') || []) {
      const cardId = cardMap.get(clean(record.entityKey));
      if (!cardId) { blocking.push(`Classification without matching Card: ${record.entityKey}`); continue; }
      const p = asObject(record.payload);
      tables.card_classification.push({
        card_id: cardId,
        entry_types: asArray(p.entryTypes).map(String),
        usage_tags: asArray(p.usageTags).map(String),
        topic_tags: asArray(p.topicTags).map(String),
        discovery_tags: asArray(p.discoveryTags).map(String),
        revision: numeric(p.revision) || 1,
        field_meta: {},
        updated_at: isoTime(p.updatedAt),
        updated_by_device: nullable(p.updatedByDevice),
        deleted_at: isoTime(p.deletedAt)
      });
      consumed.add(record);
    }

    for (const record of byType.get('learning_session') || []) {
      const p = asObject(record.payload);
      const session = asObject(p.session);
      const stream = clean(p.sourceStream) || clean(record.entityKey).split(':')[0] || 'unknown';
      const sourceSessionId = sourceId(session, ['sessionId','session_id','id']) || clean(record.entityKey).replace(new RegExp(`^${stream}:`), '');
      const canonicalId = await uuidV5(`session|${record.entityKey}`);
      sessionSourceMap.set(`${stream}|${sourceSessionId}`, canonicalId);
      if (!sessionSourceMap.has(`*|${sourceSessionId}`)) sessionSourceMap.set(`*|${sourceSessionId}`, canonicalId);
      tables.learning_sessions.push({
        session_id: canonicalId,
        source_session_id: sourceSessionId || null,
        session_type: stream,
        source_mode: nullable(session.mode ?? session.practiceMode ?? session.sourceMode),
        device_id: nullable(session.deviceId ?? session.device_id),
        started_at: isoTime(session.startedAt ?? session.started_at ?? session.createdAt ?? session.timestamp),
        ended_at: isoTime(session.endedAt ?? session.ended_at ?? session.completedAt ?? session.updatedAt),
        status: clean(session.status) || (session.completedAt || session.endedAt ? 'completed' : 'unknown'),
        summary: session.summary ?? null,
        payload: session,
        schema_version: numeric(session.schemaVersion ?? session.version) || 1,
        created_at: isoTime(session.createdAt ?? session.startedAt ?? session.timestamp),
        updated_at: isoTime(session.updatedAt ?? session.endedAt ?? session.completedAt ?? session.startedAt)
      });
      consumed.add(record);
    }

    for (const record of byType.get('learning_event') || []) {
      const p = asObject(record.payload);
      const event = asObject(p.event);
      const stream = clean(p.sourceStream) || clean(record.entityKey).split(':')[0] || 'unknown';
      const sourceEventId = sourceId(event, ['eventId','event_id','id']) || clean(record.entityKey).replace(new RegExp(`^${stream}:`), '');
      const wid = firstWordId(event);
      const cardId = wid ? cardMap.get(`wid:${wid}`) || null : null;
      if (wid && !cardId) bump(audit.missingEventCards, wid);
      const sourceSessionId = firstSessionId(event);
      const sessionId = sourceSessionId ? (sessionSourceMap.get(`${stream}|${sourceSessionId}`) || sessionSourceMap.get(`*|${sourceSessionId}`) || null) : null;
      if (sourceSessionId && !sessionId) bump(audit.missingEventSessions, `${stream}|${sourceSessionId}`);
      tables.learning_events.push({
        event_id: await uuidV5(`event|${record.entityKey}`),
        source_event_id: sourceEventId || null,
        card_id: cardId,
        session_id: sessionId,
        event_type: clean(event.eventType ?? event.type ?? event.action ?? event.routeAction ?? event.result) || 'event',
        source_stream: stream,
        occurred_at: eventTime(event),
        completed_at: isoTime(event.completedAt ?? event.completed_at),
        device_id: nullable(event.deviceId ?? event.device_id),
        legacy_word_id: numeric(wid),
        schema_version: numeric(event.schemaVersion ?? event.version) || 1,
        payload: event,
        imported_at: null,
        supersedes_event_id: null
      });
      consumed.add(record);
    }

    for (const record of byType.get('learning_state') || []) {
      const legacyKey = clean(record.entityKey);
      const cardId = cardMap.get(legacyKey);
      if (!cardId) { blocking.push(`Learning State without matching Card: ${legacyKey}`); continue; }
      const p = asObject(record.payload);
      const reviewLevel = clean(p.reviewLevel ?? p.attention ?? p.reviewAttention ?? p.level);
      const reviewReasons = asArray(p.reviewReasons ?? p.reasons).map(String);
      const lastSeen = isoTime(p.lastSeen ?? p.last_seen_at);
      const lastStudied = isoTime(p.lastStudied ?? p.lastStudiedAt ?? p.last_studied_at);
      const lastReviewed = isoTime(p.lastReviewed ?? p.lastReviewedAt ?? p.last_reviewed_at ?? p.attentionUpdatedAt);
      const lastPracticed = isoTime(p.lastPracticed ?? p.lastPracticedAt ?? p.last_practiced_at);
      const updateCandidates = [lastSeen,lastStudied,lastReviewed,lastPracticed,isoTime(p.updatedAt),isoTime(p.lastAttentionUpdatedAt)].filter(Boolean).sort();
      tables.learning_state.push({
        card_id: cardId,
        studied: Boolean(p.studied),
        known: typeof p.known === 'boolean' ? p.known : null,
        review: Boolean(p.review ?? reviewLevel),
        review_level: reviewLevel || null,
        review_reasons: reviewReasons,
        exposure_count: numeric(p.exposureCount ?? p.exposures) || 0,
        study_count: numeric(p.studyCount) || 0,
        review_count: numeric(p.reviewCount) || 0,
        attempt_count: numeric(p.attemptCount ?? p.attempts) || 0,
        last_seen_at: lastSeen,
        last_studied_at: lastStudied,
        last_reviewed_at: lastReviewed,
        last_practiced_at: lastPracticed,
        last_result: nullable(p.lastResult ?? p.result),
        last_attention_updated_at: isoTime(p.lastAttentionUpdatedAt ?? p.attentionUpdatedAt),
        state_source: 'migrated_snapshot',
        field_meta: {},
        revision: numeric(p.revision) || 1,
        derived_through_change_seq: null,
        updated_at: updateCandidates.length ? updateCandidates[updateCandidates.length - 1] : null,
        source_snapshot: p
      });
      consumed.add(record);
    }

    for (const record of byType.get('learner_profile') || []) {
      tables.learner_profile.push({ profile: record.payload, revision: numeric(record.payload?.revision) || 1, updated_at: isoTime(record.payload?.updatedAt), updated_by_device: nullable(record.payload?.updatedByDevice) });
      consumed.add(record);
    }
    for (const record of byType.get('learner_route_state') || []) {
      tables.learner_route_state.push({ route_state: record.payload, revision: numeric(record.payload?.revision) || 1, updated_at: isoTime(record.payload?.updatedAt), updated_by_device: nullable(record.payload?.updatedByDevice) });
      consumed.add(record);
    }

    for (const record of byType.get('study_context') || []) {
      const p = asObject(record.payload);
      const sourceContextId = clean(p.contextId ?? p.id) || clean(record.entityKey);
      const contextId = await uuidV5(`context|${record.entityKey}`);
      const wordIds = asArray(p.source?.wordIds).map(clean).filter(Boolean);
      for (let ordinal = 0; ordinal < wordIds.length; ordinal += 1) {
        const cardId = cardMap.get(`wid:${wordIds[ordinal]}`);
        if (!cardId) { bump(audit.missingContextCards, wordIds[ordinal]); continue; }
        tables.study_context_cards.push({ context_id: contextId, ordinal, card_id: cardId, state: null });
      }
      const currentWid = clean(p.progress?.currentWordId);
      const currentCardId = currentWid ? cardMap.get(`wid:${currentWid}`) || null : null;
      if (currentWid && !currentCardId) bump(audit.missingContextCards, currentWid);
      const sourceSessionId = clean(p.sessionRef?.sessionId);
      const sourceSessionType = clean(p.sessionRef?.type);
      const sessionId = sourceSessionId ? (sessionSourceMap.get(`${sourceSessionType}|${sourceSessionId}`) || sessionSourceMap.get(`*|${sourceSessionId}`) || null) : null;
      if (sourceSessionId && !sessionId) bump(audit.missingContextSessions, `${sourceSessionType || '*'}|${sourceSessionId}`);
      tables.study_contexts.push({
        context_id: contextId,
        source_context_id: sourceContextId,
        context_type: clean(p.sourceType) || 'context',
        label: clean(p.source?.label),
        status: clean(p.status) || 'active',
        current_ordinal: numeric(p.progress?.currentIndex),
        current_card_id: currentCardId,
        source_mode: nullable(p.practiceMode),
        session_id: sessionId,
        payload: p,
        revision: numeric(p.revision) || 1,
        created_at: isoTime(p.createdAt),
        updated_at: isoTime(p.lastMeaningfulAt ?? p.updatedAt ?? p.createdAt),
        completed_at: isoTime(p.completedAt),
        deleted_at: isoTime(p.deletedAt)
      });
      consumed.add(record);
    }

    for (const record of byType.get('study_build') || []) {
      const p = asObject(record.payload);
      const sourceBuildId = clean(p.buildId ?? p.id) || clean(record.entityKey);
      const buildId = await uuidV5(`build|${record.entityKey}`);
      const wordIds = asArray(p.wordIds).map(clean).filter(Boolean);
      for (let ordinal = 0; ordinal < wordIds.length; ordinal += 1) {
        const cardId = cardMap.get(`wid:${wordIds[ordinal]}`);
        if (!cardId) { bump(audit.missingBuildCards, wordIds[ordinal]); continue; }
        tables.study_build_cards.push({ build_id: buildId, ordinal, card_id: cardId });
      }
      tables.study_builds.push({
        build_id: buildId,
        source_build_id: sourceBuildId,
        label: clean(p.label ?? p.recipe?.label),
        recipe: asObject(p.recipe),
        marker: nullable(p.studyMarker ?? p.marker),
        payload: p,
        created_at: isoTime(p.createdAt),
        updated_at: isoTime(p.lastUsedAt ?? p.updatedAt ?? p.createdAt),
        deleted_at: isoTime(p.deletedAt)
      });
      consumed.add(record);
    }

    for (const record of byType.get('user_links') || []) {
      const p = record.payload;
      const obj = asObject(p);
      const categories = asArray(obj.categories);
      const links = asArray(obj.links);
      if (!categories.length && !links.length && Array.isArray(p)) {
        asArray(p).forEach((link, index) => links.push({ ...asObject(link), __index: index }));
      }
      for (let ordinal = 0; ordinal < categories.length; ordinal += 1) {
        const category = asObject(categories[ordinal]);
        const sourceCategoryId = clean(category.categoryId ?? category.id) || `index:${ordinal}:${await sha256(stableStringify(category))}`;
        tables.user_link_categories.push({ category_id: await uuidV5(`link-category|${sourceCategoryId}`), source_category_id: sourceCategoryId, name: clean(category.name ?? category.label), ordinal, created_at: isoTime(category.createdAt), updated_at: isoTime(category.updatedAt), deleted_at: isoTime(category.deletedAt) });
      }
      for (let ordinal = 0; ordinal < links.length; ordinal += 1) {
        const link = asObject(links[ordinal]);
        const sourceLinkId = clean(link.linkId ?? link.id) || `index:${ordinal}:${await sha256(stableStringify(link))}`;
        const sourceCategoryId = clean(link.categoryId ?? link.category_id);
        tables.user_links.push({
          link_id: await uuidV5(`link|${sourceLinkId}`),
          source_link_id: sourceLinkId,
          category_id: sourceCategoryId ? await uuidV5(`link-category|${sourceCategoryId}`) : null,
          label: clean(link.label ?? link.name ?? link.title),
          url: clean(link.url ?? link.href),
          ordinal,
          created_at: isoTime(link.createdAt),
          updated_at: isoTime(link.updatedAt),
          deleted_at: isoTime(link.deletedAt)
        });
      }
      if (!categories.length && !links.length && p != null) warnings.push('User Links payload exists but its current shape could not be split into canonical category/link rows; raw payload remains source evidence only.');
      consumed.add(record);
    }

    const preferenceGroups = new Map();
    for (const record of byType.get('user_preference') || []) {
      const p = asObject(record.payload);
      const key = clean(p.key) || clean(record.entityKey);
      const section = preferenceSection(key);
      if (!preferenceGroups.has(section)) preferenceGroups.set(section, {});
      preferenceGroups.get(section)[key] = p.value;
      consumed.add(record);
    }
    for (const [section, payload] of [...preferenceGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      tables.user_preferences.push({ section, payload, revision: 1, updated_at: null, updated_by_device: null });
    }

    const recognizedTypes = new Set([
      'card','card_content','card_learning_metadata','card_classification','learning_session','learning_event','learning_state',
      'learner_profile','learner_route_state','study_context','study_build','user_links','user_preference'
    ]);
    for (const [type, items] of byType.entries()) {
      if (!recognizedTypes.has(type)) blocking.push(`Unmapped Shadow entity type: ${type} (${items.length} records).`);
    }

    for (const [table, rows] of Object.entries(tables)) {
      const keys = rows.map(row => tablePrimaryKey(table, row));
      const empty = keys.filter(key => !key).length;
      const duplicate = keys.length - new Set(keys).size;
      if (empty) blocking.push(`${table}: ${empty} row(s) have no canonical primary key.`);
      if (duplicate) blocking.push(`${table}: ${duplicate} duplicate canonical primary key(s).`);
    }

    const cards = new Set(tables.cards.map(row => row.card_id));
    const checkCardFk = (table, field = 'card_id') => {
      const missing = tables[table].filter(row => row[field] && !cards.has(row[field]));
      if (missing.length) blocking.push(`${table}: ${missing.length} unresolved Card reference(s).`);
    };
    ['card_content','card_learning_metadata','learning_situations','learning_alternatives','card_classification','learning_events','learning_state','study_context_cards','study_build_cards'].forEach(table => checkCardFk(table));
    if (tables.card_content.length !== tables.cards.length) blocking.push(`Card/content count mismatch: ${tables.cards.length} cards vs ${tables.card_content.length} content rows.`);

    const situations = new Set(tables.learning_situations.map(row => row.situation_id));
    const alternatives = new Set(tables.learning_alternatives.map(row => row.alternative_id));
    const brokenAlternativeLinks = tables.learning_alternative_situations.filter(row => !situations.has(row.situation_id) || !alternatives.has(row.alternative_id));
    if (brokenAlternativeLinks.length) blocking.push(`learning_alternative_situations: ${brokenAlternativeLinks.length} unresolved link(s).`);

    const contexts = new Set(tables.study_contexts.map(row => row.context_id));
    const brokenContextCards = tables.study_context_cards.filter(row => !contexts.has(row.context_id));
    if (brokenContextCards.length) blocking.push(`study_context_cards: ${brokenContextCards.length} unresolved Context reference(s).`);
    const builds = new Set(tables.study_builds.map(row => row.build_id));
    const brokenBuildCards = tables.study_build_cards.filter(row => !builds.has(row.build_id));
    if (brokenBuildCards.length) blocking.push(`study_build_cards: ${brokenBuildCards.length} unresolved Build reference(s).`);
    const linkCategories = new Set(tables.user_link_categories.map(row => row.category_id));
    const brokenLinkCategories = tables.user_links.filter(row => row.category_id && !linkCategories.has(row.category_id));
    if (brokenLinkCategories.length) blocking.push(`user_links: ${brokenLinkCategories.length} unresolved Link Category reference(s).`);

    const summarizeAudit = (label, map, noun) => {
      if (!map.size) return;
      const total = [...map.values()].reduce((sum, value) => sum + value, 0);
      const examples = [...map.keys()].slice(0, 4).join(', ');
      warnings.push(`${label}: ${total} ${noun}${total === 1 ? '' : 's'} across ${map.size} missing reference${map.size === 1 ? '' : 's'}${examples ? ` · ${examples}` : ''}.`);
    };
    summarizeAudit('Learning Events', audit.missingEventCards, 'event');
    summarizeAudit('Learning Event historical sessions', audit.missingEventSessions, 'event');
    summarizeAudit('Study Context cards', audit.missingContextCards, 'card reference');
    summarizeAudit('Study Context historical sessions', audit.missingContextSessions, 'context');
    summarizeAudit('Study Build cards', audit.missingBuildCards, 'card reference');

    const sourceRecordCount = records.length;
    const consumedCount = consumed.size;
    if (consumedCount !== sourceRecordCount) {
      const remainder = records.filter(record => !consumed.has(record));
      blocking.push(`Source coverage mismatch: ${sourceRecordCount - consumedCount} Shadow record(s) were not consumed by the dry run.`);
      remainder.slice(0, 20).forEach(record => blocking.push(`Unconsumed: ${record.entityType}|${record.entityKey}`));
    }

    // Stable per-table ordering for deterministic hashes and repeatable reports.
    Object.entries(tables).forEach(([table, rows]) => rows.sort((a, b) => tablePrimaryKey(table, a).localeCompare(tablePrimaryKey(table, b))));

    const coreLibraryTables = ['cards','card_content','card_classification'];
    const personalLibraryTables = ['cards','card_content','card_learning_metadata','learning_situations','learning_alternatives','learning_alternative_situations','card_classification'];
    const learningTables = ['learning_sessions','learning_events','learning_state','learner_profile','learner_route_state','study_contexts','study_context_cards','study_builds','study_build_cards'];
    const selectTables = names => Object.fromEntries(names.map(name => [name, tables[name]]));
    const canonicalRows = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
    const tableCounts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
    const cardMappingHash = await sha256(tables.cards.map(row => `${row.legacy_key}|${row.card_id}`).sort().join('\n'));
    const coreLibraryHash = await sha256(stableStringify(selectTables(coreLibraryTables)));
    const personalLibraryHash = await sha256(stableStringify(selectTables(personalLibraryTables)));
    const learningHash = await sha256(stableStringify(selectTables(learningTables)));
    const fullCanonicalHash = await sha256(stableStringify(tables));
    const tableHashes = {};
    for (const [name, rows] of Object.entries(tables)) tableHashes[name] = await sha256(stableStringify(rows));

    return {
      migrationVersion: MIGRATION_VERSION,
      namespaceUuid: CANONICAL_NAMESPACE_UUID,
      sourceRecordCount,
      consumedCount,
      canonicalRows,
      tableCounts,
      hashes: { cardMappingHash, coreLibraryHash, personalLibraryHash, learningHash, fullCanonicalHash, tableHashes },
      blocking,
      warnings,
      tables
    };
  }

  function renderTableCounts(counts) {
    const body = $('migration-table-body');
    body.innerHTML = '';
    Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, count]) => {
      const tr = document.createElement('tr');
      [name, Number(count).toLocaleString()].forEach(text => { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); });
      body.appendChild(tr);
    });
  }

  function renderIssues(report) {
    const list = $('migration-issues');
    list.innerHTML = '';
    const items = [
      ...report.issues.blocking.map(value => `BLOCKING · ${value}`),
      ...report.issues.warnings.map(value => `AUDIT · ${value}`)
    ];
    if (!items.length) {
      const li = document.createElement('li');
      li.textContent = 'No structural reference or coverage issues detected.';
      list.appendChild(li);
      return;
    }
    items.forEach(value => { const li = document.createElement('li'); li.textContent = value; list.appendChild(li); });
  }

  function render(report) {
    $('migration-source-count').textContent = report.summary.sourceRecords.toLocaleString();
    $('migration-row-count').textContent = report.summary.canonicalRows.toLocaleString();
    $('migration-blocking-count').textContent = String(report.summary.blockingIssues);
    $('migration-warning-count').textContent = String(report.summary.auditWarnings);
    $('migration-rerun').textContent = report.summary.rerunStable ? 'PASS' : 'CHECK';
    $('migration-card-hash').textContent = report.hashes.cardMappingHash;
    $('migration-core-hash').textContent = report.hashes.coreLibraryHash;
    $('migration-library-hash').textContent = report.hashes.personalLibraryHash;
    $('migration-learning-hash').textContent = report.hashes.learningHash;
    $('migration-full-hash').textContent = report.hashes.fullCanonicalHash;
    renderTableCounts(report.tableCounts);
    renderIssues(report);
    $('migration-status').className = `status-line ${report.summary.blockingIssues ? 'error' : 'success'}`;
    $('migration-status').textContent = report.summary.blockingIssues
      ? `Canonical migration dry run completed with ${report.summary.blockingIssues} blocking issue${report.summary.blockingIssues === 1 ? '' : 's'}. Nothing was written.`
      : `Canonical migration dry run PASS · ${report.summary.canonicalRows.toLocaleString()} canonical rows derived · no WLP or Cloud data modified.`;
    $('migration-panel').classList.remove('hidden');
    $('export-migration').disabled = false;
  }

  async function runMigrationDryRun() {
    const snapshot = window.WLPCloudShadow?.getLatestSnapshot?.();
    if (!snapshot || !Array.isArray(snapshot.records)) throw new Error('Run Local Scan first.');
    const button = $('run-migration');
    button.disabled = true;
    $('export-migration').disabled = true;
    $('migration-panel').classList.remove('hidden');
    $('migration-status').className = 'status-line';
    $('migration-status').textContent = 'Building the planned Cloud Schema v1 shape locally and validating references…';

    try {
      const first = await buildCanonical(snapshot);
      const second = await buildCanonical(snapshot);
      const rerunStable = first.hashes.fullCanonicalHash === second.hashes.fullCanonicalHash
        && first.hashes.coreLibraryHash === second.hashes.coreLibraryHash
        && stableStringify(first.tableCounts) === stableStringify(second.tableCounts);
      const generatedAt = new Date().toISOString();
      state.report = {
        format: 'WLP_CANONICAL_MIGRATION_DRY_RUN',
        version: 1,
        migrationVersion: MIGRATION_VERSION,
        generatedAt,
        source: {
          shadowPhase: snapshot.report?.phase || '',
          snapshotHash: snapshot.report?.snapshotHash || '',
          masterSha256: snapshot.report?.master?.sha256 || '',
          logicalRecords: snapshot.records.length
        },
        identity: {
          namespaceUuid: CANONICAL_NAMESPACE_UUID,
          cardNameRule: 'card|<legacyKey>',
          cardMappingHash: first.hashes.cardMappingHash
        },
        summary: {
          sourceRecords: first.sourceRecordCount,
          consumedSourceRecords: first.consumedCount,
          canonicalRows: first.canonicalRows,
          tables: Object.keys(first.tables).length,
          blockingIssues: first.blocking.length + (rerunStable ? 0 : 1),
          auditWarnings: first.warnings.length,
          rerunStable
        },
        tableCounts: first.tableCounts,
        hashes: first.hashes,
        issues: {
          blocking: rerunStable ? first.blocking : [...first.blocking, 'Same-run canonical output was not deterministic.'],
          warnings: first.warnings
        },
        deferredServerBindings: [
          'auth user_id / owner scope',
          'server-side row timestamps where the legacy source has none',
          'registered canonical device_id rows',
          'field-level version metadata for final conflict-aware write path'
        ],
        invariants: {
          noWlpWrites: true,
          noShadowIndexedDbWrites: true,
          noCloudReads: true,
          noCloudWrites: true,
          legacyStorageRemainsSourceOfTruth: true
        }
      };
      render(state.report);
    } catch (error) {
      console.error('WLP Canonical Migration dry run failed:', error);
      $('migration-status').className = 'status-line error';
      $('migration-status').textContent = error?.message || String(error);
    } finally {
      button.disabled = false;
    }
  }

  function exportMigrationReport() {
    if (!state.report) return;
    const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wlp-canonical-migration-dry-run-${state.report.generatedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function refreshButton() {
    const snapshot = window.WLPCloudShadow?.getLatestSnapshot?.();
    $('run-migration').disabled = !snapshot;
  }

  function handleScanComplete() {
    state.report = null;
    $('export-migration').disabled = true;
    if (!$('migration-panel').classList.contains('hidden')) {
      $('migration-status').className = 'status-line';
      $('migration-status').textContent = 'Local snapshot refreshed. Run the Canonical Migration dry run again before exporting or comparing hashes.';
    }
    refreshButton();
  }

  function init() {
    $('run-migration').addEventListener('click', runMigrationDryRun);
    $('export-migration').addEventListener('click', exportMigrationReport);
    window.addEventListener('wlp-cloud-shadow-scan-complete', handleScanComplete);
    window.WLPCanonicalMigrationDryRun = Object.freeze({ buildCanonical });
    refreshButton();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
