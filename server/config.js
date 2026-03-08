import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const cacheDir = path.join(rootDir, 'data', 'cache');
const runtimeDir = path.join(rootDir, 'data', 'runtime');

const aircraftDbUrl =
  process.env.AIRCRAFT_DB_URL ??
  'https://s3.opensky-network.org/data-samples/metadata/aircraft-database-complete-2024-10.csv';
const aircraftDbFilename = path.basename(new URL(aircraftDbUrl).pathname);

export const ROOT_DIR = rootDir;
export const CACHE_DIR = cacheDir;
export const RUNTIME_DIR = runtimeDir;
export const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 3000);
export const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3001);
export const SERVER_HOST = process.env.SERVER_HOST ?? '0.0.0.0';
export const LIVE_CACHE_TTL_MS = Number(process.env.LIVE_CACHE_TTL_MS ?? 15000);
export const LIVE_REFRESH_INTERVAL_MS = Number(process.env.LIVE_REFRESH_INTERVAL_MS ?? 15000);
export const LIVE_UNAUTHENTICATED_REFRESH_INTERVAL_MS = Number(
  process.env.LIVE_UNAUTHENTICATED_REFRESH_INTERVAL_MS ?? 900000,
);
export const SESSION_COOKIE_NAME = 'whatsupp_session';
export const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 7);
export const AUTH_CONFIG_PATH = path.join(runtimeDir, 'auth-config.json');
export const SESSION_SECRET_PATH = path.join(runtimeDir, 'session-secret.txt');
export const TRACKING_DB_PATH = path.join(runtimeDir, 'tracking.sqlite');
export const LIVE_URL = 'https://opensky-network.org/api/states/all?extended=1';
export const OPENSKY_AUTH_URL =
  process.env.OPENSKY_AUTH_URL ??
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
export const OPENSKY_TOKEN = process.env.OPENSKY_TOKEN ?? '';
export const OPENSKY_CLIENT_ID = process.env.OPENSKY_CLIENT_ID ?? '';
export const OPENSKY_CLIENT_SECRET = process.env.OPENSKY_CLIENT_SECRET ?? '';
export const DOC8643_URL =
  process.env.DOC8643_URL ??
  'https://s3.opensky-network.org/data-samples/metadata/doc8643AircraftTypes.csv';
export const DOC8643_PATH = path.join(cacheDir, 'doc8643AircraftTypes.csv');
export const AIRCRAFT_DB_URL = aircraftDbUrl;
export const AIRCRAFT_DB_PATH = path.join(cacheDir, aircraftDbFilename);
export const AIRCRAFT_LOOKUP_DB_PATH = path.join(cacheDir, 'aircraft-lookup.sqlite');
export const JET_FUEL_DENSITY_KG_PER_L = 0.8;
export const CO2_KG_PER_KG_FUEL = 3.16;
export const PAYPAL_ENV = process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';
export const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID ?? '';
export const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET ?? '';
export const PAYPAL_CURRENCY = process.env.PAYPAL_CURRENCY ?? 'EUR';
export const PAYPAL_SUPPORT_AMOUNT = process.env.PAYPAL_SUPPORT_AMOUNT ?? '29.00';
export const TRACKING_RETENTION_DAYS = Number(process.env.TRACKING_RETENTION_DAYS ?? 30);
export const BACKGROUND_TRACKING_ENABLED = process.env.BACKGROUND_TRACKING_ENABLED !== 'false';
export const BACKGROUND_TRACKING_BOOT_DELAY_MS = Number(
  process.env.BACKGROUND_TRACKING_BOOT_DELAY_MS ?? 2000,
);
