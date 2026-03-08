import { LIVE_CACHE_TTL_MS, LIVE_URL } from './config.js';

const MAX_HISTORY_FRAMES = 24;

let liveCache = {
  data: null,
  fetchedAt: 0,
  inFlight: null,
};
const liveHistory = [];

function toNumber(value) {
  return typeof value === 'number' ? value : null;
}

function sanitizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeStateVector(row) {
  return {
    icao24: sanitizeString(row[0])?.toLowerCase() ?? null,
    callsign: sanitizeString(row[1]),
    originCountry: sanitizeString(row[2]),
    timePosition: toNumber(row[3]),
    lastContact: toNumber(row[4]),
    longitude: toNumber(row[5]),
    latitude: toNumber(row[6]),
    baroAltitudeM: toNumber(row[7]),
    onGround: row[8] === true,
    velocityMps: toNumber(row[9]),
    trackDeg: toNumber(row[10]),
    verticalRateMps: toNumber(row[11]),
    geoAltitudeM: toNumber(row[13]),
    squawk: sanitizeString(row[14]),
    spi: row[15] === true,
    positionSource: toNumber(row[16]),
    category: toNumber(row[17]),
  };
}

async function fetchLiveData() {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'flighttracker-dashboard/1.0 (+https://github.com/meinzeug/flighttracker)',
  };

  if (process.env.OPENSKY_TOKEN) {
    headers.Authorization = `Bearer ${process.env.OPENSKY_TOKEN}`;
  }

  const response = await fetch(LIVE_URL, { headers });
  if (!response.ok) {
    throw new Error(`OpenSky live request failed with ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const deduped = new Map();

  for (const row of payload.states ?? []) {
    if (!Array.isArray(row) || row[8] !== false) {
      continue;
    }

    const state = normalizeStateVector(row);
    if (!state.icao24) {
      continue;
    }

    deduped.set(state.icao24, state);
  }

  return {
    observedAt: payload.time ? new Date(payload.time * 1000).toISOString() : new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    states: [...deduped.values()],
  };
}

function storeHistoryFrame(snapshot) {
  if (liveHistory[0]?.observedAt === snapshot.observedAt) {
    return;
  }

  liveHistory.unshift({
    observedAt: snapshot.observedAt,
    fetchedAt: snapshot.fetchedAt,
    states: snapshot.states,
  });

  if (liveHistory.length > MAX_HISTORY_FRAMES) {
    liveHistory.length = MAX_HISTORY_FRAMES;
  }
}

export function getPlaybackFrames() {
  return [...liveHistory]
    .map((frame) => ({
      observedAt: frame.observedAt,
      aircraftCount: frame.states.length,
    }))
    .reverse();
}

export async function getSnapshotAt(observedAt) {
  if (!liveHistory.length) {
    await getLiveSnapshot();
  }

  const requestedAt = Date.parse(observedAt ?? '');
  if (!Number.isFinite(requestedAt) || !liveHistory.length) {
    return null;
  }

  let nearest = liveHistory[0];
  let nearestDelta = Math.abs(Date.parse(liveHistory[0].observedAt) - requestedAt);

  for (const frame of liveHistory) {
    const delta = Math.abs(Date.parse(frame.observedAt) - requestedAt);
    if (delta < nearestDelta) {
      nearest = frame;
      nearestDelta = delta;
    }
  }

  return {
    ...nearest,
    stale: true,
    playback: true,
  };
}

export async function getLiveSnapshot() {
  const now = Date.now();
  if (liveCache.data && now - liveCache.fetchedAt < LIVE_CACHE_TTL_MS) {
    return { ...liveCache.data, stale: false };
  }

  if (liveCache.inFlight) {
    return liveCache.inFlight;
  }

  liveCache.inFlight = fetchLiveData()
    .then((data) => {
      liveCache.data = data;
      liveCache.fetchedAt = Date.now();
      storeHistoryFrame(data);
      return { ...data, stale: false };
    })
    .catch((error) => {
      if (liveCache.data) {
        return { ...liveCache.data, stale: true, error: error.message };
      }

      throw error;
    })
    .finally(() => {
      liveCache.inFlight = null;
    });

  return liveCache.inFlight;
}
