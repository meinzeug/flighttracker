const OVERPASS_API_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];
const USGS_EARTHQUAKE_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_PORT_ZOOM = 4;
const MIN_NETWORK_ZOOM = 5;

const responseCache = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBounds(bounds) {
  return {
    west: clamp(toNumber(bounds.west, -180), -180, 180),
    south: clamp(toNumber(bounds.south, -85), -85, 85),
    east: clamp(toNumber(bounds.east, 180), -180, 180),
    north: clamp(toNumber(bounds.north, 85), -85, 85),
    zoom: clamp(toNumber(bounds.zoom, 1), 1, 18),
  };
}

function quantize(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function makeCacheKey(layers, bounds) {
  const normalizedBounds = normalizeBounds(bounds);
  return JSON.stringify({
    layers: [...new Set(layers)].sort(),
    west: quantize(normalizedBounds.west),
    south: quantize(normalizedBounds.south),
    east: quantize(normalizedBounds.east),
    north: quantize(normalizedBounds.north),
    zoom: quantize(normalizedBounds.zoom, 1),
  });
}

function getCachedResponse(key) {
  const cached = responseCache.get(key);
  if (!cached || cached.expiresAt < Date.now()) {
    responseCache.delete(key);
    return null;
  }

  return cached.value;
}

function setCachedResponse(key, value) {
  responseCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value,
  });
}

function pointInBounds(longitude, latitude, bounds) {
  return (
    typeof longitude === 'number' &&
    typeof latitude === 'number' &&
    longitude >= bounds.west &&
    longitude <= bounds.east &&
    latitude >= bounds.south &&
    latitude <= bounds.north
  );
}

function centroidFromCoordinates(coordinates) {
  if (!coordinates?.length) {
    return null;
  }

  let totalLongitude = 0;
  let totalLatitude = 0;
  for (const point of coordinates) {
    totalLongitude += point[0];
    totalLatitude += point[1];
  }

  return [totalLongitude / coordinates.length, totalLatitude / coordinates.length];
}

function hasGasDescriptor(tags = {}) {
  const haystack = [
    tags.substance,
    tags.content,
    tags.product,
    tags.industrial,
    tags.commodity,
    tags.operator,
    tags.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return /\b(gas|natural[_ -]?gas|lng|cng)\b/.test(haystack);
}

function categoryForElement(tags = {}) {
  if (tags.power === 'substation') {
    return 'substation';
  }

  if (tags.power === 'plant') {
    return 'power_plant';
  }

  if (['line', 'minor_line', 'cable'].includes(tags.power)) {
    return 'power_line';
  }

  if (tags.man_made === 'pipeline' && hasGasDescriptor(tags)) {
    return 'gas_pipeline';
  }

  if (
    ['storage_tank', 'works', 'gasometer', 'compressor_station'].includes(tags.man_made) &&
    hasGasDescriptor(tags)
  ) {
    return 'gas_site';
  }

  if (tags.industrial === 'gas' || tags['industrial:type'] === 'gas_facility') {
    return 'gas_site';
  }

  if (tags.amenity === 'ferry_terminal') {
    return 'ferry_terminal';
  }

  if (tags.route === 'ferry') {
    return 'shipping_route';
  }

  if (tags.harbour || tags['seamark:type'] === 'harbour') {
    return 'port';
  }

  return null;
}

function featureFromOverpassElement(element) {
  const category = categoryForElement(element.tags);
  if (!category) {
    return null;
  }

  if (element.type === 'node') {
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [element.lon, element.lat],
      },
      properties: {
        id: `${element.type}/${element.id}`,
        category,
        name: element.tags?.name ?? null,
        tags: element.tags ?? {},
      },
    };
  }

  const geometryPoints = Array.isArray(element.geometry)
    ? element.geometry
        .filter((point) => typeof point?.lon === 'number' && typeof point?.lat === 'number')
        .map((point) => [point.lon, point.lat])
    : [];

  if (!geometryPoints.length) {
    return null;
  }

  if (
    ['substation', 'port', 'ferry_terminal', 'power_plant', 'gas_site'].includes(category)
  ) {
    const centroid = centroidFromCoordinates(geometryPoints);
    if (!centroid) {
      return null;
    }

    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: centroid,
      },
      properties: {
        id: `${element.type}/${element.id}`,
        category,
        name: element.tags?.name ?? null,
        tags: element.tags ?? {},
      },
    };
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: geometryPoints,
    },
    properties: {
      id: `${element.type}/${element.id}`,
      category,
      name: element.tags?.name ?? null,
      tags: element.tags ?? {},
    },
  };
}

function buildOverpassQuery(bounds, layers) {
  const { south, west, north, east } = normalizeBounds(bounds);
  const segments = [];

  if (layers.includes('powerGrid')) {
    segments.push(
      `way["power"~"line|minor_line|cable"](${south},${west},${north},${east});`,
      `relation["power"~"line|minor_line|cable"](${south},${west},${north},${east});`,
      `node["power"="substation"](${south},${west},${north},${east});`,
      `way["power"="substation"](${south},${west},${north},${east});`,
      `relation["power"="substation"](${south},${west},${north},${east});`,
    );
  }

  if (layers.includes('gasPipelines')) {
    segments.push(
      `way["man_made"="pipeline"]["substance"~"gas|natural_gas",i](${south},${west},${north},${east});`,
      `relation["man_made"="pipeline"]["substance"~"gas|natural_gas",i](${south},${west},${north},${east});`,
      `way["man_made"="pipeline"]["content"~"gas|natural_gas",i](${south},${west},${north},${east});`,
      `relation["man_made"="pipeline"]["content"~"gas|natural_gas",i](${south},${west},${north},${east});`,
      `way["man_made"="pipeline"]["product"~"gas|natural_gas",i](${south},${west},${north},${east});`,
      `relation["man_made"="pipeline"]["product"~"gas|natural_gas",i](${south},${west},${north},${east});`,
    );
  }

  if (layers.includes('ports')) {
    segments.push(
      `node["harbour"](${south},${west},${north},${east});`,
      `way["harbour"](${south},${west},${north},${east});`,
      `way["landuse"="port"](${south},${west},${north},${east});`,
      `node["amenity"="ferry_terminal"](${south},${west},${north},${east});`,
      `way["amenity"="ferry_terminal"](${south},${west},${north},${east});`,
      `node["seamark:type"="harbour"](${south},${west},${north},${east});`,
    );
  }

  if (layers.includes('shippingRoutes')) {
    segments.push(
      `way["route"="ferry"](${south},${west},${north},${east});`,
      `relation["route"="ferry"](${south},${west},${north},${east});`,
    );
  }

  if (layers.includes('powerPlants')) {
    segments.push(
      `node["power"="plant"](${south},${west},${north},${east});`,
      `way["power"="plant"](${south},${west},${north},${east});`,
      `relation["power"="plant"](${south},${west},${north},${east});`,
    );
  }

  if (layers.includes('gasSites')) {
    segments.push(
      `node["man_made"~"storage_tank|works|gasometer|compressor_station"]["substance"~"gas|natural_gas|lng|cng",i](${south},${west},${north},${east});`,
      `way["man_made"~"storage_tank|works|gasometer|compressor_station"]["substance"~"gas|natural_gas|lng|cng",i](${south},${west},${north},${east});`,
      `node["man_made"~"storage_tank|works|gasometer|compressor_station"]["content"~"gas|natural_gas|lng|cng",i](${south},${west},${north},${east});`,
      `way["man_made"~"storage_tank|works|gasometer|compressor_station"]["content"~"gas|natural_gas|lng|cng",i](${south},${west},${north},${east});`,
      `node["industrial"="gas"](${south},${west},${north},${east});`,
      `way["industrial"="gas"](${south},${west},${north},${east});`,
    );
  }

  if (!segments.length) {
    return null;
  }

  return `[out:json][timeout:25];(${segments.join('')});out geom;`;
}

async function fetchOverpassLayer(bounds, layer) {
  const normalizedBounds = normalizeBounds(bounds);
  const minZoom = layer === 'ports' ? MIN_PORT_ZOOM : MIN_NETWORK_ZOOM;
  if (normalizedBounds.zoom < minZoom) {
    return [];
  }

  const query = buildOverpassQuery(normalizedBounds, [layer]);
  if (!query) {
    return [];
  }

  let lastError = null;

  for (const endpoint of OVERPASS_API_URLS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'User-Agent': 'whatsupp-dashboard/1.0 (+https://github.com/meinzeug/whatsupp)',
        },
        body: query,
      });

      if (!response.ok) {
        lastError = new Error(`Overpass API failed with ${response.status} on ${endpoint}`);
        if ([429, 500, 502, 503, 504].includes(response.status)) {
          continue;
        }

        throw lastError;
      }

      const payload = await response.json();
      return (payload.elements ?? [])
        .map((element) => featureFromOverpassElement(element))
        .filter(Boolean);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Overpass query failed');
    }
  }

  throw lastError ?? new Error('Overpass query failed without a specific error');
}

function dedupeFeatures(features) {
  const seen = new Set();
  return features.filter((feature) => {
    const id = feature?.properties?.id;
    if (!id || seen.has(id)) {
      return false;
    }

    seen.add(id);
    return true;
  });
}

async function fetchOverpassFeatures(bounds, layers) {
  const layerResults = await Promise.allSettled(
    [...new Set(layers)]
      .filter((layer) =>
        ['powerGrid', 'gasPipelines', 'ports', 'shippingRoutes', 'powerPlants', 'gasSites'].includes(layer),
      )
      .map(async (layer) => ({
        layer,
        features: await fetchOverpassLayer(bounds, layer),
      })),
  );

  const warnings = [];
  const features = [];

  for (const result of layerResults) {
    if (result.status === 'fulfilled') {
      features.push(...result.value.features);
      continue;
    }

    warnings.push(
      result.reason instanceof Error ? result.reason.message : 'Overpass-Abfrage fehlgeschlagen.',
    );
  }

  return {
    features: dedupeFeatures(features),
    warnings,
  };
}

async function fetchEarthquakeFeatures(bounds) {
  const normalizedBounds = normalizeBounds(bounds);
  const response = await fetch(USGS_EARTHQUAKE_URL, {
    headers: {
      'User-Agent': 'whatsupp-dashboard/1.0 (+https://github.com/meinzeug/whatsupp)',
    },
  });

  if (!response.ok) {
    throw new Error(`USGS earthquake feed failed with ${response.status}`);
  }

  const payload = await response.json();
  return (payload.features ?? [])
    .filter((feature) => {
      const [longitude, latitude] = feature?.geometry?.coordinates ?? [];
      return pointInBounds(longitude, latitude, normalizedBounds);
    })
    .map((feature) => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        id: feature.id,
        category: 'earthquake',
        name: feature.properties?.place ?? 'Earthquake',
        magnitude: feature.properties?.mag ?? null,
        observedAt: feature.properties?.time ? new Date(feature.properties.time).toISOString() : null,
      },
    }));
}

function summarizeFeatures(features) {
  return features.reduce((accumulator, feature) => {
    const category = feature?.properties?.category;
    if (!category) {
      return accumulator;
    }

    accumulator[category] = (accumulator[category] ?? 0) + 1;
    return accumulator;
  }, {});
}

export async function getPublicMapFeatures({ layers = [], bounds = {} } = {}) {
  const normalizedLayers = [...new Set(layers)].filter(Boolean);
  const cacheKey = makeCacheKey(normalizedLayers, bounds);
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    return cached;
  }

  const warnings = [];
  const [earthquakesResult, overpassResult] = await Promise.allSettled([
    normalizedLayers.includes('earthquakes') ? fetchEarthquakeFeatures(bounds) : Promise.resolve([]),
    normalizedLayers.some((layer) =>
      ['powerGrid', 'gasPipelines', 'ports', 'shippingRoutes', 'powerPlants', 'gasSites'].includes(layer),
    )
      ? fetchOverpassFeatures(bounds, normalizedLayers)
      : Promise.resolve({ features: [], warnings: [] }),
  ]);

  const earthquakes =
    earthquakesResult.status === 'fulfilled' ? earthquakesResult.value : [];
  if (earthquakesResult.status === 'rejected') {
    warnings.push(`USGS feed: ${earthquakesResult.reason instanceof Error ? earthquakesResult.reason.message : 'unbekannter Fehler'}`);
  }

  const overpassFeatures =
    overpassResult.status === 'fulfilled' ? overpassResult.value.features : [];
  if (overpassResult.status === 'fulfilled') {
    warnings.push(...overpassResult.value.warnings);
  }
  if (overpassResult.status === 'rejected') {
    warnings.push(`Overpass: ${overpassResult.reason instanceof Error ? overpassResult.reason.message : 'unbekannter Fehler'}`);
  }

  const features = [...earthquakes, ...overpassFeatures];

  const response = {
    type: 'FeatureCollection',
    features,
    generatedAt: new Date().toISOString(),
    warnings,
    meta: {
      activeLayers: normalizedLayers,
      counts: summarizeFeatures(features),
      bounds: normalizeBounds(bounds),
    },
  };

  setCachedResponse(cacheKey, response);
  return response;
}
