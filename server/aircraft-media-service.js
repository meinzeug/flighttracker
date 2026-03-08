const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'whatsupp-dashboard/1.0 (+https://github.com/meinzeug/whatsupp)';
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;

const mediaCache = new Map();

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCacheKey(query) {
  return JSON.stringify(query).toLowerCase();
}

function pushQuery(queries, value) {
  const normalized = clean(value);
  if (!normalized || queries.includes(normalized)) {
    return;
  }

  queries.push(normalized);
}

function shorten(text, maxLength = 220) {
  const normalized = clean(text);
  if (!normalized || normalized.length <= maxLength) {
    return normalized || null;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function normalizeForMatch(value) {
  return clean(value).toLowerCase();
}

function scoreCandidate(page, query) {
  const normalizedTitle = normalizeForMatch(page.title);
  const normalizedDescription = normalizeForMatch(page.description ?? page.extract);
  const normalizedQuery = normalizeForMatch(query);
  const strippedQuery = normalizedQuery.replace(/\baircraft\b/g, '').replace(/\s+/g, ' ').trim();
  const tokens = strippedQuery.split(' ').filter((token) => token.length > 2);
  let score = 0;

  if (page.thumbnail?.source) {
    score += 12;
  }

  if (strippedQuery && normalizedTitle === strippedQuery) {
    score += 60;
  }

  if (strippedQuery && normalizedTitle.includes(strippedQuery)) {
    score += 30;
  }

  for (const token of tokens) {
    if (normalizedTitle.includes(token)) {
      score += 8;
    }

    if (normalizedDescription.includes(token)) {
      score += 2;
    }
  }

  score -= (page.index ?? 10) * 0.5;
  return score;
}

function buildSearchQueries({ manufacturerName, model, typecode, typeFamily, operator, owner }) {
  const queries = [];
  const fullModel = clean([manufacturerName, model].filter(Boolean).join(' '));

  pushQuery(queries, `${fullModel} aircraft`);
  pushQuery(queries, fullModel);
  pushQuery(queries, `${model} aircraft`);
  pushQuery(queries, model);
  pushQuery(queries, `${manufacturerName} ${typecode} aircraft`);
  pushQuery(queries, `${manufacturerName} ${typeFamily} aircraft`);
  pushQuery(queries, `${typecode} aircraft`);
  pushQuery(queries, `${typeFamily} aircraft`);
  pushQuery(queries, `${operator} ${model} aircraft`);
  pushQuery(queries, `${owner} ${model} aircraft`);

  return queries.slice(0, 8);
}

async function searchWikipedia(query) {
  const url = new URL(WIKIPEDIA_API_URL);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', query);
  url.searchParams.set('gsrlimit', '3');
  url.searchParams.set('prop', 'pageimages|description|extracts|info');
  url.searchParams.set('exintro', '1');
  url.searchParams.set('explaintext', '1');
  url.searchParams.set('exchars', '260');
  url.searchParams.set('inprop', 'url');
  url.searchParams.set('piprop', 'thumbnail');
  url.searchParams.set('pithumbsize', '960');

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Wikipedia media lookup failed with ${response.status}`);
  }

  const payload = await response.json();
  const pages = Object.values(payload?.query?.pages ?? {}).sort(
    (left, right) => scoreCandidate(right, query) - scoreCandidate(left, query),
  );
  const candidate = pages[0];

  if (!candidate) {
    return null;
  }

  return {
    title: candidate.title ?? query,
    description: shorten(candidate.description ?? candidate.extract),
    imageUrl: candidate.thumbnail?.source ?? null,
    articleUrl: candidate.fullurl ?? candidate.canonicalurl ?? null,
    source: 'Wikipedia',
    query,
  };
}

export async function resolveAircraftMedia(metadata) {
  const cacheKey = buildCacheKey(metadata);
  const cached = mediaCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const queries = buildSearchQueries(metadata);
  if (!queries.length) {
    mediaCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: null,
    });
    return null;
  }

  let firstResult = null;
  for (const query of queries) {
    const result = await searchWikipedia(query);
    if (!result) {
      continue;
    }

    if (!firstResult) {
      firstResult = result;
    }

    if (result.imageUrl) {
      mediaCache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        value: result,
      });
      return result;
    }
  }

  mediaCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: firstResult,
  });

  return firstResult;
}
