'use strict';

const plannerResponseSchema = require('../../planner-writer-response-v1.schema.json');
const interpreterResponseSchema = require('../../interpreter-router-response-v1.schema.json');

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.6-luna';
const MAX_BODY_BYTES = 512 * 1024;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify(body)
  };
}

function clean(value) {
  return String(value ?? '').trim();
}

function sanitizeSchema(value) {
  if (Array.isArray(value)) return value.map(sanitizeSchema);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (['$schema', '$id', 'title'].includes(key)) continue;
    out[key] = sanitizeSchema(item);
  }
  return out;
}

function extractOutputText(response) {
  const texts = [];
  const refusals = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') texts.push(part.text);
      if (part?.type === 'refusal' && typeof part.refusal === 'string') refusals.push(part.refusal);
    }
  }
  return { text: texts.join('\n').trim(), refusal: refusals.join('\n').trim() };
}

function validateEnvelope(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Request body must be a JSON object.';
  if (body.schemaVersion !== 1) return 'schemaVersion must be 1.';
  if (!['planner', 'interpreter', 'health'].includes(body.kind)) return 'kind must be planner, interpreter, or health.';
  if (body.kind === 'health') return '';
  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) return 'payload must be an object.';
  if (body.kind === 'planner' && body.payload.contract !== 'planner-writer-v1.request') return 'Planner payload contract mismatch.';
  if (body.kind === 'interpreter') {
    if (body.payload.contract !== 'interpreter-router-v1.request') return 'Interpreter payload contract mismatch.';
    if (!clean(body.eventId)) return 'Interpreter request requires eventId.';
  }
  return '';
}

function plannerInstructions() {
  return `You are the Planner + Experience Writer for WLP AI Study.

Your job is NOT merely to elicit a target word. Build or test meaningful connections between expressions and situations, experiences, concepts, message cores, communicative focus, speaker intent, consequences, register, neighboring expressions, and personal anchors.

Core design rules:
- Begin from a meaningful world/situation/concept/discourse structure, not from a dictionary-definition paraphrase.
- A target may be deliberately elicited when appropriate, but the situation must strongly motivate why a speaker would choose it there.
- Distinguish "the target could be used" from "the target has a real communicative job here." Merely possible usage is not enough for a production experience.
- Explain the target's contribution: what perspective, focus, construal, nuance, relationship, or communicative work it adds.
- Respect natural alternatives. Do not design a scene where a much more ordinary neighbor would obviously be preferred and then force the target.
- The learner's existing good words are scaffolds, not errors to replace.
- Prefer a new useful connection over cosmetic repetition of a recent route, frame, domain, or cue.
- Use Personal Anchors, learner-generated neighbors, production tendencies, and prior diagnostic evidence when relevant.
- Message Core -> Communicative Focus / Construal -> Expression is central. The same situation may naturally support different wording when the speaker foregrounds something different.
- Experience grounding may be concrete, situational, conceptual, procedural, terminological, contrastive, or discourse-based depending on the expression. Technical/legal terminology need not be forced into a simplistic everyday scene.
- Do not claim mastery. Do not turn learning into correct-answer accumulation.
- If recent evidence is already sufficient, create an experience whose value is genuinely different; otherwise PAUSE is handled later by the Router.

Return only the contract JSON. Preserve requestId and sessionId exactly. selectedTarget must come from the supplied target packets.`;
}

function interpreterInstructions() {
  return `You are the Interpreter + Router for WLP AI Study.

Interpret the learner response as evidence about a growing language network, not as a binary correct/incorrect answer.

Core design rules:
- Use authoritativeResponse. If the learner corrected STT, the corrected response outranks raw STT.
- Distinguish exact target, target family, natural neighbor, natural alternative, partial concept, form/POS mismatch, sense mismatch, register mismatch, construal shift, unrelated response, and uncertainty.
- A natural alternative is evidence, not failure. If the prompt naturally favors another expression, do not penalize the learner.
- Compare Message Core and Communicative Focus: what did the learner foreground, and how does that differ from the experience/target focus?
- Preserve lexical-family or concept access even when POS, morphology, valency, voice, or construction choice is off.
- Treat personal tendencies cautiously. One observation must not become a recurring trait. Low-confidence or STT-uncertain evidence must not promote the learner profile.
- Learner-generated neighbors and spontaneous production are high-value evidence.
- Failed or unnatural AI routes are themselves diagnostic evidence and should be preserved when useful.
- Router actions: DEEPEN, BRANCH, TRANSFER, CONTRAST, REVERSE, COMPOSE, PAUSE. Prefer PAUSE when another immediate turn is unlikely to add a useful new connection.
- Keep learner-facing feedback natural and proportionate. Internal analysis may be detailed; the learner-facing response should not sound like telemetry.
- Never delete stored state, mark mastery, or replace the learner profile. Return additive patch proposals only.

Return only the contract JSON. Preserve requestId and sessionId exactly. eventId must exactly match the eventId supplied by the server in the user payload.`;
}

function buildOpenAIRequest(kind, payload, eventId) {
  const planner = kind === 'planner';
  const responseSchema = planner ? plannerResponseSchema : interpreterResponseSchema;
  const schemaName = planner ? 'wlp_planner_writer_v1' : 'wlp_interpreter_router_v1';
  const inputPayload = planner ? payload : { ...payload, eventId };
  const maxOutputTokens = Number.parseInt(process.env.WLP_AI_MAX_OUTPUT_TOKENS || '8000', 10);

  return {
    model: clean(process.env.WLP_AI_MODEL) || DEFAULT_MODEL,
    store: false,
    instructions: planner ? plannerInstructions() : interpreterInstructions(),
    input: JSON.stringify(inputPayload),
    max_output_tokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 8000,
    text: {
      format: {
        type: 'json_schema',
        name: schemaName,
        description: planner
          ? 'WLP Planner + Experience Writer contract response.'
          : 'WLP Interpreter + Router contract response.',
        schema: sanitizeSchema(responseSchema),
        strict: false
      }
    }
  };
}

async function callOpenAI(kind, payload, eventId) {
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not configured on the server.');
    error.code = 'WLP_AI_NOT_CONFIGURED';
    error.statusCode = 503;
    throw error;
  }

  const request = buildOpenAIRequest(kind, payload, eventId);
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request)
  });

  let body;
  try { body = await response.json(); } catch (_) { body = null; }
  if (!response.ok) {
    const error = new Error(clean(body?.error?.message) || `OpenAI API returned HTTP ${response.status}`);
    error.code = clean(body?.error?.code) || 'WLP_AI_PROVIDER_ERROR';
    error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
    error.providerStatus = response.status;
    throw error;
  }

  if (body?.status && body.status !== 'completed') {
    const error = new Error(clean(body?.error?.message) || `OpenAI response status was ${body.status}`);
    error.code = 'WLP_AI_PROVIDER_INCOMPLETE';
    error.statusCode = 502;
    throw error;
  }

  const extracted = extractOutputText(body);
  if (extracted.refusal && !extracted.text) {
    const error = new Error('The model declined to produce the requested learning contract output.');
    error.code = 'WLP_AI_PROVIDER_REFUSAL';
    error.statusCode = 422;
    throw error;
  }
  if (!extracted.text) {
    const error = new Error('OpenAI returned no text output.');
    error.code = 'WLP_AI_PROVIDER_EMPTY';
    error.statusCode = 502;
    throw error;
  }

  let result;
  try { result = JSON.parse(extracted.text); } catch (_) {
    const error = new Error('OpenAI returned output that could not be parsed as JSON.');
    error.code = 'WLP_AI_PROVIDER_BAD_JSON';
    error.statusCode = 502;
    throw error;
  }

  return {
    result,
    meta: {
      provider: 'openai',
      model: clean(body?.model || request.model),
      responseId: clean(body?.id),
      usage: body?.usage || null,
      stored: false
    }
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } });

  const rawBody = event.body || '';
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: { code: 'REQUEST_TOO_LARGE', message: 'AI Study request is too large.' } });
  }

  let body;
  try { body = JSON.parse(rawBody || '{}'); } catch (_) {
    return json(400, { ok: false, error: { code: 'BAD_JSON', message: 'Request body must be valid JSON.' } });
  }

  const envelopeError = validateEnvelope(body);
  if (envelopeError) return json(400, { ok: false, error: { code: 'BAD_REQUEST', message: envelopeError } });

  if (body.kind === 'health') {
    return json(200, {
      ok: true,
      service: 'wlp-ai-study',
      schemaVersion: 1,
      configured: Boolean(clean(process.env.OPENAI_API_KEY)),
      model: clean(process.env.WLP_AI_MODEL) || DEFAULT_MODEL
    });
  }

  try {
    const output = await callOpenAI(body.kind, body.payload, clean(body.eventId));
    return json(200, { ok: true, kind: body.kind, result: output.result, meta: output.meta });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return json(statusCode, {
      ok: false,
      error: {
        code: clean(error?.code) || 'WLP_AI_SERVER_ERROR',
        message: clean(error?.message) || 'AI Study server error.'
      }
    });
  }
};

exports._test = Object.freeze({
  sanitizeSchema,
  extractOutputText,
  validateEnvelope,
  buildOpenAIRequest
});
