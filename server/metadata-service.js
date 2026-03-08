import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse as parseSync } from 'csv-parse/sync';
import Database from 'better-sqlite3';

import {
  AIRCRAFT_DB_PATH,
  AIRCRAFT_LOOKUP_DB_PATH,
  AIRCRAFT_DB_URL,
  CACHE_DIR,
  DOC8643_PATH,
  DOC8643_URL,
} from './config.js';

const aircraftCache = new Map();
const typeCatalog = new Map();
const execFile = promisify(execFileCb);

let aircraftDbPromise = null;
let docCatalogPromise = null;
let aircraftDbError = null;
let docCatalogError = null;
let aircraftDbReady = false;
let docCatalogReady = false;
let lookupDbReady = false;
let lookupDbPromise = null;
let lookupDbError = null;
let lookupDatabase = null;

function normalizeIcao24(value) {
  return String(value ?? '').trim().toLowerCase();
}

function clean(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function toInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAircraftRecord(row) {
  return {
    icao24: normalizeIcao24(row.icao24),
    registration: clean(row.registration),
    manufacturerName: clean(row.manufacturerName),
    model: clean(row.model),
    typecode: clean(row.typecode)?.toUpperCase() ?? null,
    categoryDescription: clean(row.categoryDescription),
    operator: clean(row.operator),
    operatorCallsign: clean(row.operatorCallsign),
    operatorIata: clean(row.operatorIata),
    operatorIcao: clean(row.operatorIcao),
    owner: clean(row.owner),
    country: clean(row.country),
    engines: clean(row.engines),
    icaoAircraftClass: clean(row.icaoAircraftClass),
    registered: clean(row.registered),
    built: clean(row.built),
  };
}

function normalizeTypeRecord(row) {
  return {
    designator: clean(row.Designator)?.toUpperCase() ?? null,
    description: clean(row.Description),
    aircraftDescription: clean(row.AircraftDescription),
    engineCount: toInteger(row.EngineCount),
    engineType: clean(row.EngineType),
    manufacturerCode: clean(row.ManufacturerCode),
    modelFullName: clean(row.ModelFullName),
    wtc: clean(row.WTC),
  };
}

async function downloadFile(url, targetPath) {
  await mkdir(CACHE_DIR, { recursive: true });

  const tmpPath = `${targetPath}.tmp`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'whatsupp-dashboard/1.0 (+https://github.com/meinzeug/whatsupp)',
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${url}: ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(tmpPath));
  await rename(tmpPath, targetPath);
}

async function ensureDocCatalogLoaded() {
  if (docCatalogReady) {
    return;
  }

  if (!docCatalogPromise) {
    docCatalogPromise = (async () => {
      try {
        if (!existsSync(DOC8643_PATH)) {
          await downloadFile(DOC8643_URL, DOC8643_PATH);
        }

        const raw = await readFile(DOC8643_PATH, 'utf8');
        const rows = parseSync(raw, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });

        for (const row of rows) {
          const record = normalizeTypeRecord(row);
          if (!record.designator) {
            continue;
          }

          const existing = typeCatalog.get(record.designator);
          if (!existing || (record.modelFullName?.length ?? 0) > (existing.modelFullName?.length ?? 0)) {
            typeCatalog.set(record.designator, record);
          }
        }

        docCatalogReady = true;
      } catch (error) {
        docCatalogError = error;
        throw error;
      }
    })();
  }

  return docCatalogPromise;
}

async function ensureAircraftDatabase({ awaitReady = false } = {}) {
  if (aircraftDbReady) {
    return;
  }

  if (!aircraftDbPromise) {
    aircraftDbPromise = (async () => {
      try {
        if (!existsSync(AIRCRAFT_DB_PATH)) {
          await downloadFile(AIRCRAFT_DB_URL, AIRCRAFT_DB_PATH);
        }

        aircraftDbReady = true;
      } catch (error) {
        aircraftDbError = error;
        try {
          await unlink(`${AIRCRAFT_DB_PATH}.tmp`);
        } catch {}
        throw error;
      }
    })().finally(() => {
      if (!aircraftDbReady) {
        aircraftDbPromise = null;
      }
    });
  }

  if (awaitReady) {
    return aircraftDbPromise;
  }
}

async function ensureLookupDatabase({ awaitReady = false } = {}) {
  if (lookupDbReady && existsSync(AIRCRAFT_LOOKUP_DB_PATH)) {
    return;
  }

  if (!lookupDbPromise) {
    lookupDbPromise = (async () => {
      try {
        await ensureAircraftDatabase({ awaitReady: true });

        const csvStats = await stat(AIRCRAFT_DB_PATH);
        const sqliteStats = await stat(AIRCRAFT_LOOKUP_DB_PATH).catch(() => null);
        const shouldRebuild = !sqliteStats || sqliteStats.mtimeMs < csvStats.mtimeMs;

        if (shouldRebuild) {
          await execFile('python3', [
            new URL('../scripts/build_aircraft_lookup_db.py', import.meta.url).pathname,
            AIRCRAFT_DB_PATH,
            AIRCRAFT_LOOKUP_DB_PATH,
          ]);
        }

        lookupDbReady = true;
      } catch (error) {
        lookupDbError = error;
        throw error;
      }
    })().finally(() => {
      if (!lookupDbReady) {
        lookupDbPromise = null;
      }
    });
  }

  if (awaitReady) {
    return lookupDbPromise;
  }
}

function getLookupDatabase() {
  if (!lookupDatabase) {
    lookupDatabase = new Database(AIRCRAFT_LOOKUP_DB_PATH, {
      readonly: true,
      fileMustExist: true,
    });
  }

  return lookupDatabase;
}

export async function resolveAircraftMetadata(icao24List) {
  await ensureDocCatalogLoaded();
  await ensureLookupDatabase({ awaitReady: true });

  if (!lookupDbReady) {
    return new Map();
  }

  const normalizedIds = icao24List.map((value) => normalizeIcao24(value)).filter(Boolean);
  const missing = normalizedIds.filter((icao24) => !aircraftCache.has(icao24));

  if (missing.length) {
    const database = getLookupDatabase();

    for (let index = 0; index < missing.length; index += 900) {
      const chunk = missing.slice(index, index + 900);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = database
        .prepare(
          `SELECT icao24,
                  registration,
                  manufacturer_name AS manufacturerName,
                  model,
                  typecode,
                  category_description AS categoryDescription,
                  operator,
                  operator_callsign AS operatorCallsign,
                  operator_iata AS operatorIata,
                  operator_icao AS operatorIcao,
                  owner,
                  country,
                  engines,
                  icao_aircraft_class AS icaoAircraftClass,
                  registered,
                  built
             FROM aircraft
            WHERE icao24 IN (${placeholders})`,
        )
        .all(...chunk);

      const found = new Set();
      for (const row of rows) {
        const record = normalizeAircraftRecord(row);
        aircraftCache.set(record.icao24, record);
        found.add(record.icao24);
      }

      for (const icao24 of chunk) {
        if (!found.has(icao24)) {
          aircraftCache.set(icao24, null);
        }
      }
    }
  }

  return new Map(
    normalizedIds.map((icao24) => [icao24, aircraftCache.get(icao24) ?? null]),
  );
}

export async function getTypeRecord(typecode) {
  await ensureDocCatalogLoaded();
  if (!typecode) {
    return null;
  }

  return typeCatalog.get(String(typecode).trim().toUpperCase()) ?? null;
}

export async function warmupMetadata() {
  ensureDocCatalogLoaded().catch(() => {});
  ensureLookupDatabase({ awaitReady: false }).catch(() => {});
}

export async function getMetadataStatus() {
  const [docStats, aircraftStats] = await Promise.allSettled([
    stat(DOC8643_PATH),
    stat(AIRCRAFT_DB_PATH),
  ]);

  return {
    docCatalogReady,
    aircraftDbReady,
    lookupDbReady,
    docCatalogError: docCatalogError?.message ?? null,
    aircraftDbError: aircraftDbError?.message ?? null,
    lookupDbError: lookupDbError?.message ?? null,
    typeCatalogSize: typeCatalog.size,
    aircraftLookupCacheSize: aircraftCache.size,
    docCatalogBytes: docStats.status === 'fulfilled' ? docStats.value.size : 0,
    aircraftDbBytes: aircraftStats.status === 'fulfilled' ? aircraftStats.value.size : 0,
    aircraftDbSource: AIRCRAFT_DB_URL,
  };
}
