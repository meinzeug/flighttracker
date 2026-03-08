import fs from 'node:fs';

import Database from 'better-sqlite3';

import { RUNTIME_DIR, TRACKING_DB_PATH, TRACKING_RETENTION_DAYS } from './config.js';

let trackingDatabase = null;
let prepared = null;

function ensureRuntimeDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function getDatabase() {
  if (trackingDatabase) {
    return trackingDatabase;
  }

  ensureRuntimeDir();
  trackingDatabase = new Database(TRACKING_DB_PATH);
  trackingDatabase.pragma('journal_mode = WAL');
  trackingDatabase.pragma('synchronous = NORMAL');
  trackingDatabase.pragma('foreign_keys = ON');
  trackingDatabase.pragma('temp_store = MEMORY');
  trackingDatabase.pragma('busy_timeout = 5000');

  trackingDatabase.exec(`
    CREATE TABLE IF NOT EXISTS tracking_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      object_type TEXT NOT NULL,
      source TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      stale INTEGER NOT NULL DEFAULT 0,
      object_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(object_type, observed_at)
    );

    CREATE TABLE IF NOT EXISTS tracked_objects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      object_type TEXT NOT NULL,
      external_id TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      latest_label TEXT,
      latest_type TEXT,
      latest_operator TEXT,
      latest_country TEXT,
      latest_payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(object_type, external_id)
    );

    CREATE TABLE IF NOT EXISTS tracked_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL REFERENCES tracking_snapshots(id) ON DELETE CASCADE,
      object_id INTEGER NOT NULL REFERENCES tracked_objects(id) ON DELETE CASCADE,
      object_type TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      altitude_m REAL,
      speed_mps REAL,
      heading_deg REAL,
      vertical_rate_mps REAL,
      on_ground INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(snapshot_id, object_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tracking_snapshots_type_observed
      ON tracking_snapshots(object_type, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tracked_objects_type_external
      ON tracked_objects(object_type, external_id);
    CREATE INDEX IF NOT EXISTS idx_tracked_positions_type_observed
      ON tracked_positions(object_type, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tracked_positions_object_observed
      ON tracked_positions(object_id, observed_at DESC);
  `);

  prepared = {
    upsertSnapshot: trackingDatabase.prepare(`
      INSERT INTO tracking_snapshots (
        object_type,
        source,
        observed_at,
        fetched_at,
        stale,
        object_count
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(object_type, observed_at) DO UPDATE SET
        source = excluded.source,
        fetched_at = excluded.fetched_at,
        stale = excluded.stale,
        object_count = excluded.object_count
      RETURNING id
    `),
    upsertObject: trackingDatabase.prepare(`
      INSERT INTO tracked_objects (
        object_type,
        external_id,
        first_seen_at,
        last_seen_at,
        latest_label,
        latest_type,
        latest_operator,
        latest_country,
        latest_payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(object_type, external_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        latest_label = excluded.latest_label,
        latest_type = excluded.latest_type,
        latest_operator = excluded.latest_operator,
        latest_country = excluded.latest_country,
        latest_payload_json = excluded.latest_payload_json,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `),
    insertPosition: trackingDatabase.prepare(`
      INSERT INTO tracked_positions (
        snapshot_id,
        object_id,
        object_type,
        observed_at,
        latitude,
        longitude,
        altitude_m,
        speed_mps,
        heading_deg,
        vertical_rate_mps,
        on_ground,
        payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_id, object_id) DO UPDATE SET
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        altitude_m = excluded.altitude_m,
        speed_mps = excluded.speed_mps,
        heading_deg = excluded.heading_deg,
        vertical_rate_mps = excluded.vertical_rate_mps,
        on_ground = excluded.on_ground,
        payload_json = excluded.payload_json
    `),
    playbackFrames: trackingDatabase.prepare(`
      SELECT observed_at AS observedAt,
             object_count AS aircraftCount
      FROM tracking_snapshots
      WHERE object_type = ?
      ORDER BY observed_at DESC
      LIMIT ?
    `),
    nearestSnapshot: trackingDatabase.prepare(`
      SELECT id,
             object_type AS objectType,
             source,
             observed_at AS observedAt,
             fetched_at AS fetchedAt,
             stale,
             object_count AS objectCount
      FROM tracking_snapshots
      WHERE object_type = ?
      ORDER BY ABS(strftime('%s', observed_at) - strftime('%s', ?)) ASC
      LIMIT 1
    `),
    snapshotObjects: trackingDatabase.prepare(`
      SELECT o.external_id AS externalId,
             p.observed_at AS observedAt,
             p.payload_json AS payloadJson
      FROM tracked_positions p
      JOIN tracked_objects o ON o.id = p.object_id
      WHERE p.snapshot_id = ?
      ORDER BY o.external_id
    `),
    recentTrack: trackingDatabase.prepare(`
      SELECT p.observed_at AS observedAt,
             p.latitude,
             p.longitude,
             p.altitude_m AS altitudeM,
             p.speed_mps AS speedMps,
             p.heading_deg AS headingDeg,
             p.vertical_rate_mps AS verticalRateMps,
             p.payload_json AS payloadJson
      FROM tracked_positions p
      JOIN tracked_objects o ON o.id = p.object_id
      WHERE o.object_type = ?
        AND o.external_id = ?
      ORDER BY p.observed_at DESC
      LIMIT ?
    `),
    stats: trackingDatabase.prepare(`
      SELECT
        (SELECT COUNT(*) FROM tracking_snapshots WHERE object_type = ?) AS snapshotCount,
        (SELECT COUNT(*) FROM tracked_objects WHERE object_type = ?) AS objectCount,
        (SELECT COUNT(*) FROM tracked_positions WHERE object_type = ?) AS positionCount,
        (SELECT MIN(observed_at) FROM tracking_snapshots WHERE object_type = ?) AS oldestObservedAt,
        (SELECT MAX(observed_at) FROM tracking_snapshots WHERE object_type = ?) AS newestObservedAt
    `),
    pruneSnapshots: trackingDatabase.prepare(`
      DELETE FROM tracking_snapshots
      WHERE observed_at < ?
    `),
    pruneObjects: trackingDatabase.prepare(`
      DELETE FROM tracked_objects
      WHERE last_seen_at < ?
        AND id NOT IN (SELECT DISTINCT object_id FROM tracked_positions)
    `),
  };

  return trackingDatabase;
}

function resolveExternalId(object) {
  return String(
    object?.externalId ?? object?.icao24 ?? object?.mmsi ?? object?.imo ?? object?.id ?? '',
  )
    .trim()
    .toLowerCase();
}

function resolveLabel(object, externalId) {
  return (
    object?.callsign ??
    object?.registration ??
    object?.name ??
    object?.flight ??
    object?.typecode ??
    externalId
  );
}

function resolveType(object) {
  return object?.typecode ?? object?.shipType ?? object?.category ?? object?.typeFamily ?? null;
}

function resolveOperator(object) {
  return object?.operator ?? object?.owner ?? object?.company ?? object?.flag ?? null;
}

function resolveCountry(object) {
  return object?.originCountry ?? object?.country ?? object?.flag ?? null;
}

function parsePayload(payloadJson) {
  try {
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

const recordFrameTransaction = () => {
  getDatabase();

  return trackingDatabase.transaction(({ objectType, source, observedAt, fetchedAt, stale, objects }) => {
    const snapshotRow = prepared.upsertSnapshot.get(
      objectType,
      source,
      observedAt,
      fetchedAt,
      stale ? 1 : 0,
      objects.length,
    );

    for (const object of objects) {
      const externalId = resolveExternalId(object);
      if (!externalId) {
        continue;
      }

      const payloadJson = JSON.stringify(object);
      const objectRow = prepared.upsertObject.get(
        objectType,
        externalId,
        observedAt,
        observedAt,
        resolveLabel(object, externalId),
        resolveType(object),
        resolveOperator(object),
        resolveCountry(object),
        payloadJson,
      );

      prepared.insertPosition.run(
        snapshotRow.id,
        objectRow.id,
        objectType,
        observedAt,
        typeof object.latitude === 'number' ? object.latitude : null,
        typeof object.longitude === 'number' ? object.longitude : null,
        object.geoAltitudeM ?? object.baroAltitudeM ?? object.altitudeM ?? null,
        object.velocityMps ?? object.speedMps ?? object.speed ?? null,
        object.trackDeg ?? object.headingDeg ?? object.heading ?? null,
        object.verticalRateMps ?? object.verticalRate ?? null,
        object.onGround ? 1 : 0,
        payloadJson,
      );
    }
  });
};

const recordFrame = recordFrameTransaction();

export async function ensureTrackingStoreReady() {
  getDatabase();
}

export async function recordTrackingFrame({
  objectType = 'aircraft',
  source = 'unknown',
  observedAt,
  fetchedAt,
  stale = false,
  objects = [],
}) {
  recordFrame({
    objectType,
    source,
    observedAt,
    fetchedAt,
    stale,
    objects,
  });
}

export async function getPlaybackFrames({ objectType = 'aircraft', limit = 96 } = {}) {
  getDatabase();
  return prepared.playbackFrames.all(objectType, Math.max(1, Math.min(limit, 2000))).reverse();
}

export async function getTrackingSnapshotAt(observedAt, { objectType = 'aircraft' } = {}) {
  getDatabase();
  const snapshot = prepared.nearestSnapshot.get(objectType, observedAt);
  if (!snapshot) {
    return null;
  }

  const states = prepared.snapshotObjects.all(snapshot.id).flatMap((row) => {
    const payload = parsePayload(row.payloadJson);
    if (!payload) {
      return [];
    }

    return [
      {
        ...payload,
        externalId: row.externalId,
      },
    ];
  });

  return {
    observedAt: snapshot.observedAt,
    fetchedAt: snapshot.fetchedAt,
    states,
    stale: true,
    playback: true,
  };
}

export async function getRecentObjectTrack(externalId, { objectType = 'aircraft', limit = 16 } = {}) {
  getDatabase();
  const normalizedId = String(externalId ?? '').trim().toLowerCase();
  if (!normalizedId) {
    return [];
  }

  const rows = prepared.recentTrack.all(objectType, normalizedId, Math.max(2, Math.min(Number(limit) || 16, 256)));
  return rows
    .reverse()
    .map((row) => {
      const payload = parsePayload(row.payloadJson) ?? {};
      return {
        observedAt: row.observedAt,
        lastContact: payload.lastContact ?? null,
        latitude: row.latitude,
        longitude: row.longitude,
        geoAltitudeM: payload.geoAltitudeM ?? row.altitudeM ?? null,
        baroAltitudeM: payload.baroAltitudeM ?? row.altitudeM ?? null,
        velocityMps: payload.velocityMps ?? row.speedMps ?? null,
        trackDeg: payload.trackDeg ?? row.headingDeg ?? null,
        verticalRateMps: payload.verticalRateMps ?? row.verticalRateMps ?? null,
      };
    });
}

export async function getTrackingStats({ objectType = 'aircraft' } = {}) {
  getDatabase();
  const row = prepared.stats.get(objectType, objectType, objectType, objectType, objectType);
  return {
    objectType,
    snapshotCount: row?.snapshotCount ?? 0,
    objectCount: row?.objectCount ?? 0,
    positionCount: row?.positionCount ?? 0,
    oldestObservedAt: row?.oldestObservedAt ?? null,
    newestObservedAt: row?.newestObservedAt ?? null,
    retentionDays: TRACKING_RETENTION_DAYS,
    storagePath: TRACKING_DB_PATH,
  };
}

export async function pruneTrackingStore() {
  getDatabase();
  const cutoff = new Date(Date.now() - TRACKING_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  prepared.pruneSnapshots.run(cutoff);
  prepared.pruneObjects.run(cutoff);
}
