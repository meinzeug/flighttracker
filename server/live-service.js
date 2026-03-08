import {
  BACKGROUND_TRACKING_BOOT_DELAY_MS,
  BACKGROUND_TRACKING_ENABLED,
  LIVE_CACHE_TTL_MS,
  LIVE_REFRESH_INTERVAL_MS,
  LIVE_UNAUTHENTICATED_REFRESH_INTERVAL_MS,
  LIVE_URL,
} from './config.js';
import {
  buildOpenSkyHeaders,
  canRefreshOpenSkyAccessToken,
  getOpenSkyAccessToken,
  hasConfiguredOpenSkyAccess,
  invalidateOpenSkyAccessToken,
} from './opensky-service.js';
import {
  ensureTrackingStoreReady,
  getPlaybackFrames as getStoredPlaybackFrames,
  getRecentObjectTrack,
  getTrackingSnapshotAt,
  pruneTrackingStore,
  recordTrackingFrame,
} from './tracking-store.js';

const MAX_HISTORY_FRAMES = 24;
const DEFAULT_FAILURE_BACKOFF_MS = 60_000;
const TRACKING_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let liveCache = {
  data: null,
  fetchedAt: 0,
  inFlight: null,
  failure: null,
  nextRetryAt: 0,
};
const liveHistory = [];
let backgroundTrackingStarted = false;
let backgroundTrackingTimer = null;
let lastTrackingPruneAt = 0;

function getRecommendedLiveRefreshIntervalMs() {
  return hasConfiguredOpenSkyAccess()
    ? LIVE_REFRESH_INTERVAL_MS
    : Math.max(LIVE_REFRESH_INTERVAL_MS, LIVE_UNAUTHENTICATED_REFRESH_INTERVAL_MS);
}

function getEffectiveLiveCacheTtlMs() {
  return Math.max(LIVE_CACHE_TTL_MS, getRecommendedLiveRefreshIntervalMs());
}

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
  let accessToken = await getOpenSkyAccessToken();
  let response = await fetch(LIVE_URL, { headers: buildOpenSkyHeaders(accessToken) });

  if (response.status === 401 && accessToken && canRefreshOpenSkyAccessToken()) {
    invalidateOpenSkyAccessToken();
    accessToken = await getOpenSkyAccessToken();
    response = await fetch(LIVE_URL, { headers: buildOpenSkyHeaders(accessToken) });
  }

  if (!response.ok) {
    const statusText = response.statusText?.trim();
    const error = new Error(`OpenSky live request failed with ${response.status}${statusText ? ` ${statusText}` : ''}`);
    error.status = response.status;
    error.retryAfterMs = parseRetryAfterMs(response.headers);
    throw error;
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

function parseRetryAfterMs(headers) {
  const retryAfterSeconds = Number.parseFloat(
    headers.get('x-rate-limit-retry-after-seconds') ?? headers.get('retry-after') ?? '',
  );
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  const retryAfter = headers.get('retry-after');
  const retryAt = Date.parse(retryAfter ?? '');
  if (Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }

  return null;
}

function normalizeLiveFailure(error) {
  const failure =
    error instanceof Error ? error : new Error('OpenSky live data is currently unavailable.');

  if (failure.status === 429) {
    failure.message = hasConfiguredOpenSkyAccess()
      ? 'OpenSky rate limit reached. Reusing the latest available snapshot and retrying shortly.'
      : 'OpenSky rate limit reached for anonymous access. Reusing the latest snapshot. Configure OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET for frequent live updates.';
  } else if (failure.status === 401 || failure.status === 403) {
    failure.message =
      'OpenSky access was rejected. Configure OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET, or provide a valid OPENSKY_TOKEN.';
  }

  return failure;
}

function getFailureBackoffMs(error) {
  if (typeof error?.retryAfterMs === 'number' && error.retryAfterMs > 0) {
    return error.retryAfterMs;
  }

  if (error?.status === 429) {
    return Math.max(getEffectiveLiveCacheTtlMs(), DEFAULT_FAILURE_BACKOFF_MS);
  }

  return getEffectiveLiveCacheTtlMs();
}

function buildFallbackSnapshot(error) {
  const message = error instanceof Error ? error.message : 'OpenSky live data is currently unavailable.';

  if (liveCache.data) {
    return { ...liveCache.data, stale: true, error: message };
  }

  if (liveHistory.length) {
    return { ...liveHistory[0], stale: true, error: message };
  }

  const timestamp = new Date().toISOString();
  return {
    observedAt: timestamp,
    fetchedAt: timestamp,
    states: [],
    stale: true,
    error: message,
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

function normalizeTrackLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 16;
  }

  return Math.min(48, Math.max(2, parsed));
}

export function getPlaybackFrames() {
  return getStoredPlaybackFrames({ objectType: 'aircraft', limit: 192 });
}

export async function getSnapshotAt(observedAt) {
  const storedSnapshot = await getTrackingSnapshotAt(observedAt, { objectType: 'aircraft' });
  if (storedSnapshot) {
    return storedSnapshot;
  }

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

export async function getRecentTrack(icao24, { limit = 16 } = {}) {
  const normalizedIcao24 = sanitizeString(icao24)?.toLowerCase();
  if (!normalizedIcao24) {
    return [];
  }

  const storedTrack = await getRecentObjectTrack(normalizedIcao24, {
    objectType: 'aircraft',
    limit: normalizeTrackLimit(limit),
  });
  if (storedTrack.length) {
    return storedTrack;
  }

  if (!liveHistory.length && !liveCache.data) {
    await getLiveSnapshot();
  }

  const frames = [];
  if (liveCache.data) {
    frames.push(liveCache.data);
  }

  for (const frame of liveHistory) {
    if (frame.observedAt === liveCache.data?.observedAt) {
      continue;
    }

    frames.push(frame);
  }

  const points = [];
  const seenObservedAt = new Set();

  for (const frame of [...frames].reverse()) {
    if (!frame?.states?.length || seenObservedAt.has(frame.observedAt)) {
      continue;
    }

    const state = frame.states.find((entry) => entry.icao24 === normalizedIcao24);
    if (
      !state ||
      typeof state.latitude !== 'number' ||
      typeof state.longitude !== 'number'
    ) {
      continue;
    }

    seenObservedAt.add(frame.observedAt);
    points.push({
      observedAt: frame.observedAt,
      lastContact: state.lastContact ?? null,
      latitude: state.latitude,
      longitude: state.longitude,
      geoAltitudeM: state.geoAltitudeM ?? null,
      baroAltitudeM: state.baroAltitudeM ?? null,
      velocityMps: state.velocityMps ?? null,
      trackDeg: state.trackDeg ?? null,
      verticalRateMps: state.verticalRateMps ?? null,
    });
  }

  return points.slice(-normalizeTrackLimit(limit));
}

async function persistTrackingSnapshot(snapshot) {
  await recordTrackingFrame({
    objectType: 'aircraft',
    source: 'opensky',
    observedAt: snapshot.observedAt,
    fetchedAt: snapshot.fetchedAt,
    stale: false,
    objects: snapshot.states,
  });

  const now = Date.now();
  if (now - lastTrackingPruneAt > TRACKING_PRUNE_INTERVAL_MS) {
    lastTrackingPruneAt = now;
    await pruneTrackingStore();
  }
}

export async function getLiveSnapshot({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && liveCache.data && now - liveCache.fetchedAt < getEffectiveLiveCacheTtlMs()) {
    return { ...liveCache.data, stale: false };
  }

  if (liveCache.inFlight) {
    return liveCache.inFlight;
  }

  if (liveCache.failure && now < liveCache.nextRetryAt) {
    return buildFallbackSnapshot(liveCache.failure);
  }

  liveCache.inFlight = fetchLiveData()
    .then(async (data) => {
      liveCache.data = data;
      liveCache.fetchedAt = Date.now();
      liveCache.failure = null;
      liveCache.nextRetryAt = 0;
      storeHistoryFrame(data);
      try {
        await persistTrackingSnapshot(data);
      } catch (trackingError) {
        console.error('tracking persistence failed', trackingError);
      }
      return { ...data, stale: false };
    })
    .catch((error) => {
      const failure = normalizeLiveFailure(error);
      liveCache.failure = failure;
      liveCache.nextRetryAt = Date.now() + getFailureBackoffMs(failure);
      return buildFallbackSnapshot(failure);
    })
    .finally(() => {
      liveCache.inFlight = null;
    });

  return liveCache.inFlight;
}

export function getLiveRefreshPolicy() {
  return {
    refreshIntervalMs: getRecommendedLiveRefreshIntervalMs(),
    upstreamConfigured: hasConfiguredOpenSkyAccess(),
  };
}

function scheduleBackgroundTracking(delayMs = getRecommendedLiveRefreshIntervalMs()) {
  if (!BACKGROUND_TRACKING_ENABLED) {
    return;
  }

  if (backgroundTrackingTimer) {
    clearTimeout(backgroundTrackingTimer);
  }

  backgroundTrackingTimer = setTimeout(async () => {
    try {
      await getLiveSnapshot({ forceRefresh: true });
    } catch (error) {
      console.error('background live tracking failed', error);
    } finally {
      scheduleBackgroundTracking(getRecommendedLiveRefreshIntervalMs());
    }
  }, Math.max(1000, delayMs));
}

export async function startBackgroundTracking() {
  if (backgroundTrackingStarted || !BACKGROUND_TRACKING_ENABLED) {
    return;
  }

  backgroundTrackingStarted = true;
  await ensureTrackingStoreReady();
  scheduleBackgroundTracking(BACKGROUND_TRACKING_BOOT_DELAY_MS);
}
