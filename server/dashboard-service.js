import { classifyAircraft } from './classification.js';
import { estimateEmissions } from './emissions.js';
import { getLiveRefreshPolicy, getLiveSnapshot, getPlaybackFrames, getSnapshotAt } from './live-service.js';
import { getMetadataStatus, getTypeRecord, resolveAircraftMetadata } from './metadata-service.js';
import { getTrackingStats } from './tracking-store.js';

function topBuckets(items, keyFn, labelFn, limit = 10) {
  const buckets = new Map();

  for (const item of items) {
    const key = keyFn(item);
    if (!key) {
      continue;
    }

    const existing = buckets.get(key) ?? {
      key,
      label: labelFn(item, key),
      count: 0,
      fuelKgPerHour: 0,
      fuelLitersPerHour: 0,
      co2KgPerHour: 0,
    };

    existing.count += 1;
    existing.fuelKgPerHour += item.fuelKgPerHour;
    existing.fuelLitersPerHour += item.fuelLitersPerHour;
    existing.co2KgPerHour += item.co2KgPerHour;
    buckets.set(key, existing);
  }

  return [...buckets.values()]
    .sort((a, b) => b.co2KgPerHour - a.co2KgPerHour || b.count - a.count)
    .slice(0, limit)
    .map((bucket) => ({
      ...bucket,
      fuelKgPerHour: Math.round(bucket.fuelKgPerHour),
      fuelLitersPerHour: Math.round(bucket.fuelLitersPerHour),
      co2KgPerHour: Math.round(bucket.co2KgPerHour),
    }));
}

function defaultMetadataStatus() {
  return {
    docCatalogReady: false,
    aircraftDbReady: false,
    lookupDbReady: false,
    docCatalogError: null,
    aircraftDbError: null,
    lookupDbError: null,
    typeCatalogSize: 0,
    aircraftLookupCacheSize: 0,
    docCatalogBytes: 0,
    aircraftDbBytes: 0,
    aircraftDbSource: null,
  };
}

export async function buildDashboardSnapshot({ at = null } = {}) {
  const live = at ? (await getSnapshotAt(at)) ?? (await getLiveSnapshot()) : await getLiveSnapshot();
  const liveStates = Array.isArray(live.states) ? live.states : [];
  let metadata = new Map();
  let metadataWarning = null;

  if (liveStates.length) {
    try {
      metadata = await resolveAircraftMetadata(liveStates.map((state) => state.icao24));
    } catch (error) {
      metadataWarning =
        error instanceof Error ? `Aircraft metadata unavailable: ${error.message}` : 'Aircraft metadata unavailable.';
    }
  }

  const typeRecordCache = new Map();
  const aircraft = [];

  for (const state of liveStates) {
    const aircraftRecord = metadata.get(state.icao24) ?? null;
    const typecode = aircraftRecord?.typecode?.trim().toUpperCase() ?? null;
    let typeRecord = null;

    if (typecode) {
      if (typeRecordCache.has(typecode)) {
        typeRecord = typeRecordCache.get(typecode);
      } else {
        try {
          typeRecord = await getTypeRecord(typecode);
        } catch (error) {
          if (!metadataWarning) {
            metadataWarning =
              error instanceof Error
                ? `Aircraft type catalog unavailable: ${error.message}`
                : 'Aircraft type catalog unavailable.';
          }
        }

        typeRecordCache.set(typecode, typeRecord);
      }
    }

    const classification = classifyAircraft(state, aircraftRecord, typeRecord);
    const emissions = estimateEmissions(state, aircraftRecord, typeRecord, classification);

    aircraft.push({
      ...state,
      registration: aircraftRecord?.registration ?? null,
      manufacturerName: aircraftRecord?.manufacturerName ?? null,
      model: aircraftRecord?.model ?? typeRecord?.modelFullName ?? null,
      typecode: aircraftRecord?.typecode ?? typeRecord?.designator ?? null,
      operator: aircraftRecord?.operator ?? null,
      owner: aircraftRecord?.owner ?? null,
      operatorIcao: aircraftRecord?.operatorIcao ?? null,
      operatorIata: aircraftRecord?.operatorIata ?? null,
      categoryDescription: aircraftRecord?.categoryDescription ?? null,
      icaoAircraftClass: aircraftRecord?.icaoAircraftClass ?? null,
      operationSegment: classification.operationSegment,
      emitterCategory: classification.emitterCategory,
      typeFamily: classification.typeFamily,
      classificationConfidence: classification.confidence,
      classificationReason: classification.reason,
      engineType: emissions.engineType,
      engineCount: emissions.engineCount,
      wtc: emissions.wtc,
      fuelKgPerHour: emissions.fuelKgPerHour,
      fuelLitersPerHour: emissions.fuelLitersPerHour,
      co2KgPerHour: emissions.co2KgPerHour,
    });
  }

  const totals = aircraft.reduce(
    (accumulator, entry) => {
      accumulator.fuelKgPerHour += entry.fuelKgPerHour;
      accumulator.fuelLitersPerHour += entry.fuelLitersPerHour;
      accumulator.co2KgPerHour += entry.co2KgPerHour;
      return accumulator;
    },
    { fuelKgPerHour: 0, fuelLitersPerHour: 0, co2KgPerHour: 0 },
  );

  const resolvedTypes = aircraft.filter((entry) => entry.typecode || entry.model).length;
  const [metadataStatus, playbackFrames, trackingStatus] = await Promise.all([
    getMetadataStatus().catch(() => defaultMetadataStatus()),
    getPlaybackFrames().catch(() => []),
    getTrackingStats({ objectType: 'aircraft' }).catch(() => ({
      objectType: 'aircraft',
      snapshotCount: 0,
      objectCount: 0,
      positionCount: 0,
      oldestObservedAt: null,
      newestObservedAt: null,
      retentionDays: 0,
      storagePath: null,
    })),
  ]);
  const warnings = [live.error ?? null, metadataWarning].filter(Boolean);
  const liveRefreshPolicy = getLiveRefreshPolicy();

  return {
    observedAt: live.observedAt,
    fetchedAt: live.fetchedAt,
    stale: live.stale ?? false,
    warning: warnings.length ? warnings.join(' ') : null,
    refreshIntervalMs: liveRefreshPolicy.refreshIntervalMs,
    liveAccessConfigured: liveRefreshPolicy.upstreamConfigured,
    mode: live.playback ? 'playback' : 'live',
    totals: {
      airborneAircraft: aircraft.length,
      fuelKgPerHour: Math.round(totals.fuelKgPerHour),
      fuelLitersPerHour: Math.round(totals.fuelLitersPerHour),
      co2KgPerHour: Math.round(totals.co2KgPerHour),
      co2TonsPerHour: Number((totals.co2KgPerHour / 1000).toFixed(1)),
    },
    metadata: {
      ...metadataStatus,
      resolvedAircraft: resolvedTypes,
      coverageRatio: aircraft.length ? Number((resolvedTypes / aircraft.length).toFixed(3)) : 0,
    },
    tracking: trackingStatus,
    filters: {
      segments: [...new Set(aircraft.map((entry) => entry.operationSegment))].sort(),
      emitterCategories: [...new Set(aircraft.map((entry) => entry.emitterCategory))].sort(),
      engineTypes: [...new Set(aircraft.map((entry) => entry.engineType).filter(Boolean))].sort(),
    },
    breakdowns: {
      bySegment: topBuckets(aircraft, (entry) => entry.operationSegment, (entry) => entry.operationSegment, 12),
      byEmitterCategory: topBuckets(
        aircraft,
        (entry) => entry.emitterCategory,
        (entry) => entry.emitterCategory,
        12,
      ),
      byType: topBuckets(
        aircraft,
        (entry) => entry.typecode ?? entry.model ?? entry.typeFamily,
        (entry, key) => {
          if (entry.typecode && entry.model) {
            return `${entry.typecode} · ${entry.model}`;
          }

          return key;
        },
        16,
      ),
    },
    playback: {
      active: Boolean(live.playback),
      requestedAt: at,
      selectedObservedAt: live.observedAt,
      frames: playbackFrames,
    },
    aircraft,
    assumptions: {
      fuelModel: 'Heuristische Schaetzung anhand von Typcode, EngineType, EngineCount, WTC, Geschwindigkeit, Hoehe und Betriebssegment.',
      co2Model: 'CO2 = 3.16 kg pro kg verbranntem Kerosin; Liter sind mit ca. 0.8 kg/L umgerechnet.',
    },
  };
}
