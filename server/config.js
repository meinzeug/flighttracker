import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const cacheDir = path.join(rootDir, 'data', 'cache');

const aircraftDbUrl =
  process.env.AIRCRAFT_DB_URL ??
  'https://s3.opensky-network.org/data-samples/metadata/aircraft-database-complete-2024-10.csv';
const aircraftDbFilename = path.basename(new URL(aircraftDbUrl).pathname);

export const ROOT_DIR = rootDir;
export const CACHE_DIR = cacheDir;
export const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 3000);
export const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3001);
export const LIVE_CACHE_TTL_MS = Number(process.env.LIVE_CACHE_TTL_MS ?? 30000);
export const LIVE_URL = 'https://opensky-network.org/api/states/all?extended=1';
export const DOC8643_URL =
  process.env.DOC8643_URL ??
  'https://s3.opensky-network.org/data-samples/metadata/doc8643AircraftTypes.csv';
export const DOC8643_PATH = path.join(cacheDir, 'doc8643AircraftTypes.csv');
export const AIRCRAFT_DB_URL = aircraftDbUrl;
export const AIRCRAFT_DB_PATH = path.join(cacheDir, aircraftDbFilename);
export const AIRCRAFT_LOOKUP_DB_PATH = path.join(cacheDir, 'aircraft-lookup.sqlite');
export const JET_FUEL_DENSITY_KG_PER_L = 0.8;
export const CO2_KG_PER_KG_FUEL = 3.16;
