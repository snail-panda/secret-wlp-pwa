const LEARNERS_BASE = 'https://www.dictionaryapi.com/api/v3/references/learners/json/';
const THESAURUS_BASE = 'https://www.dictionaryapi.com/api/v3/references/thesaurus/json/';

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  },
  body: JSON.stringify(body)
});

const cleanMarkup = (value = '') => String(value)
  .replace(/\{bc\}/g, ': ')
  .replace(/\{(?:it|wi|b|sc|sup|inf)\}([^{}]*)\{\/(?:it|wi|b|sc|sup|inf)\}/g, '$1')
  .replace(/\{(?:a_link|d_link|i_link|et_link|mat|sx)\|([^|{}]+)(?:\|[^{}]*)?\}/g, '$1')
  .replace(/\{phrase\|([^|{}]+)(?:\|[^{}]*)?\}/g, '$1')
  .replace(/\{dx[^}]*\}|\{\/dx\}/g, '')
  .replace(/\{[^{}]*\}/g, '')
  .replace(/\s+([,.;:!?])/g, '$1')
  .replace(/\s{2,}/g, ' ')
  .trim()
  .replace(/^:\s*/, '');

function walk(node, visitor) {
  if (Array.isArray(node)) {
    node.forEach(item => walk(item, visitor));
    return;
  }
  if (!node || typeof node !== 'object') return;
  visitor(node);
  Object.values(node).forEach(value => walk(value, visitor));
}

function collectExamples(entry, limit = 3) {
  const out = [];
  walk(entry?.def, obj => {
    if (!Array.isArray(obj.vis)) return;
    obj.vis.forEach(item => {
      const text = cleanMarkup(item?.t);
      if (text && !out.includes(text)) out.push(text);
    });
  });
  return out.slice(0, limit);
}

function normalizeHeadword(entry) {
  return cleanMarkup(entry?.hwi?.hw || entry?.meta?.id || '').replace(/\*/g, '');
}

function isEntry(item) {
  return item && typeof item === 'object' && !Array.isArray(item) && item.meta;
}

function bestEntries(payload, query) {
  if (!Array.isArray(payload)) return [];
  const entries = payload.filter(isEntry);
  if (!entries.length) return [];
  const q = query.toLowerCase();
  const exact = entries.filter(entry => {
    const id = String(entry?.meta?.id || '').split(':')[0].toLowerCase();
    const hw = normalizeHeadword(entry).toLowerCase();
    return id === q || hw === q;
  });
  return exact.length ? exact : entries;
}

function suggestions(payload) {
  if (!Array.isArray(payload) || !payload.length || typeof payload[0] !== 'string') return [];
  return [...new Set(payload.map(String))].slice(0, 8);
}

function parseLearners(payload, query) {
  const entries = bestEntries(payload, query);
  if (!entries.length) return { suggestions: suggestions(payload) };
  const primary = entries[0];
  const definitions = entries.flatMap(entry => Array.isArray(entry.shortdef) ? entry.shortdef : [])
    .map(cleanMarkup).filter(Boolean);
  const examples = entries.flatMap(entry => collectExamples(entry, 2));
  const ipa = entries.flatMap(entry => Array.isArray(entry?.hwi?.prs) ? entry.hwi.prs : [])
    .map(pr => cleanMarkup(pr?.ipa)).find(Boolean) || '';
  return {
    headword: normalizeHeadword(primary) || query,
    ipa,
    pos: cleanMarkup(primary?.fl || ''),
    definition: [...new Set(definitions)].slice(0, 3).join('\n'),
    example: [...new Set(examples)].slice(0, 3).join('\n'),
    suggestions: []
  };
}

function parseThesaurus(payload, query) {
  const entries = bestEntries(payload, query);
  if (!entries.length) return { synonyms: '', related: '', suggestions: suggestions(payload) };
  const syns = [];
  const related = [];
  entries.forEach(entry => {
    const metaSyns = Array.isArray(entry?.meta?.syns) ? entry.meta.syns.flat(Infinity) : [];
    metaSyns.forEach(word => { const v = cleanMarkup(word); if (v && !syns.includes(v)) syns.push(v); });
    walk(entry?.def, obj => {
      if (Array.isArray(obj.syn_list)) obj.syn_list.flat(Infinity).forEach(item => {
        const v = cleanMarkup(item?.wd); if (v && !syns.includes(v)) syns.push(v);
      });
      if (Array.isArray(obj.rel_list)) obj.rel_list.flat(Infinity).forEach(item => {
        const v = cleanMarkup(item?.wd); if (v && !related.includes(v) && !syns.includes(v)) related.push(v);
      });
    });
  });
  return {
    synonyms: syns.slice(0, 12).join(', '),
    related: related.slice(0, 10).join(', '),
    suggestions: []
  };
}

async function fetchReference(base, word, key) {
  const url = `${base}${encodeURIComponent(word)}?key=${encodeURIComponent(key)}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Merriam-Webster returned ${response.status}`);
  return response.json();
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });
  const word = String(event.queryStringParameters?.word || '').trim();
  if (!word || word.length > 120) return json(400, { error: 'Enter a valid word or phrase.' });

  const learnersKey = process.env.MW_LEARNERS_API_KEY;
  const thesaurusKey = process.env.MW_THESAURUS_API_KEY;
  if (!learnersKey || !thesaurusKey) {
    return json(503, { error: 'Merriam-Webster API keys are not available in this deploy context.' });
  }

  try {
    const [learnersRaw, thesaurusRaw] = await Promise.all([
      fetchReference(LEARNERS_BASE, word, learnersKey),
      fetchReference(THESAURUS_BASE, word, thesaurusKey)
    ]);
    const learners = parseLearners(learnersRaw, word);
    const thesaurus = parseThesaurus(thesaurusRaw, word);
    const allSuggestions = [...new Set([...(learners.suggestions || []), ...(thesaurus.suggestions || [])])].slice(0, 8);
    const found = Boolean(learners.definition || learners.pos || learners.ipa || thesaurus.synonyms);
    return json(200, {
      found,
      source: 'Merriam-Webster',
      headword: learners.headword || word,
      ipa: learners.ipa || '',
      pos: learners.pos || '',
      definition: learners.definition || '',
      synonyms: thesaurus.synonyms || '',
      example: learners.example || '',
      related: thesaurus.related || '',
      suggestions: allSuggestions
    });
  } catch (error) {
    console.error('Merriam-Webster lookup failed:', error);
    return json(502, { error: 'The Merriam-Webster lookup could not be completed.' });
  }
};
