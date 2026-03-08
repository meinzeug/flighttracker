# whatsupp

`whatsupp` is a local-first open-data tracking console for live aircraft, maritime reference layers, energy infrastructure, earthquakes, and historical playback.

It combines a React/MapLibre frontend with an Express backend, persistent SQLite tracking, and public-data overlays so one workstation can operate as a situational awareness console on a desk, wall display, or kiosk system.

## Highlights

- live aircraft tracking with OpenSky enrichment
- persistent background collection with restart-safe SQLite storage
- playback and recent-track inspection from stored snapshots
- FR24-inspired map UI with selection details, search, filters, bookmarks, and weather
- open-data overlays for ports, ferry terminals, ferry routes, seamarks, power lines, substations, power plants, gas pipelines, gas sites, and earthquakes
- local authentication with bootstrap admin flow
- optional PayPal support checkout
- PM2-based local runtime for desktop or kiosk use

## Architecture

### Frontend

- `React 19`
- `Vite`
- `MapLibre GL JS`
- lazy-loaded radar and scope components

### Backend

- `Express`
- OpenSky OAuth client-credentials support
- public-data aggregation service for map overlays
- metadata enrichment and aircraft media lookup

### Persistence

- `better-sqlite3`
- `data/runtime/tracking.sqlite` for snapshots, tracked objects, and historical positions
- WAL mode for safer crash recovery and restart resilience

## Core Capabilities

### Live air picture

- global aircraft snapshot ingestion
- type, operator, engine, and segment enrichment
- estimated fuel burn and CO2 rate
- track history and follow mode

### Open-data overlays

- maritime reference: ports, ferry terminals, ferry routes, seamarks
- energy and infrastructure: power lines, substations, power plants, gas pipelines, gas sites
- events: USGS earthquakes

### Operations workflow

- search by callsign, registration, operator, ICAO24
- filter by segment, emitter category, engine type
- watchlist terms and alert feed
- playback from stored historical frames
- export of selected aircraft tracks as CSV and KML

## Runtime Modes

### Development

```bash
npm install
npm run dev
```

Default dev endpoints:

- frontend: `http://localhost:3000`
- backend: `http://localhost:3001`

### PM2 local console

```bash
npm run pm2:start
npm run pm2:status
```

Configured PM2 endpoints in this repo:

- frontend: `http://localhost:23666`
- backend: `http://localhost:23670`

The PM2 setup binds to `0.0.0.0`, so the UI can also be opened from other devices on the same LAN via the machine's `192.168.x.x` address.

## First Login

On first start, the application has no admin account.

1. Open the frontend.
2. Enter a username and password.
3. Submit the bootstrap form.
4. The first account becomes the local admin.

Authentication is stored in an `HttpOnly` session cookie.

## Configuration

### Recommended OpenSky configuration

```bash
OPENSKY_CLIENT_ID=your_client_id
OPENSKY_CLIENT_SECRET=your_client_secret
OPENSKY_AUTH_URL=https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token
```

Without authenticated OpenSky access, the server falls back to more conservative refresh behavior to avoid anonymous rate limits.

### Optional PayPal support checkout

```bash
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_CLIENT_SECRET=your_paypal_client_secret
PAYPAL_CURRENCY=EUR
PAYPAL_SUPPORT_AMOUNT=29.00
```

### Other important variables

```bash
CLIENT_PORT=3000
SERVER_PORT=3001
SERVER_HOST=0.0.0.0
LIVE_CACHE_TTL_MS=15000
SESSION_TTL_MS=604800000
TRACKING_RETENTION_DAYS=30
BACKGROUND_TRACKING_ENABLED=true
BACKGROUND_TRACKING_BOOT_DELAY_MS=2000
AIRCRAFT_DB_URL=https://s3.opensky-network.org/data-samples/metadata/aircraft-database-complete-2024-10.csv
DOC8643_URL=https://s3.opensky-network.org/data-samples/metadata/doc8643AircraftTypes.csv
```

## Persistence and Recovery

The collector is designed to continue after crashes and restarts:

- the backend collector starts automatically when the server comes up
- snapshots and positions are written continuously into SQLite
- playback reads from the database, not only from in-memory buffers
- after a server restart, stored history remains available and collection resumes automatically

## Kiosk / Desktop Launch

The kiosk bootstrap files live in `deploy/kiosk/`:

- `start-whatsupp.sh`
- `whatsupp-kiosk.desktop`

They start the PM2 stack and open the local console in a desktop session.

## Project Structure

```text
server/              API, collectors, auth, metadata, public-data services
src/                 React frontend, radar map, scope, UI logic
deploy/kiosk/        local desktop and kiosk launch helpers
docs/                architecture and expansion notes
data/cache/          downloaded metadata caches
data/runtime/        runtime state, auth config, tracking database
```

## Data Sources

Current sources used directly in the software:

- OpenSky Network
- OpenStreetMap / Overpass
- OpenSeaMap
- USGS Earthquake GeoJSON feeds
- Open-Meteo

Planned or cataloged sources for future expansion are documented in `docs/public-data-graph-architecture.md`.

## Notes on Coverage

- OpenSky does not capture every aircraft globally at all times.
- OpenStreetMap infrastructure completeness varies by region.
- Public maritime reference layers are available, but fully open global live AIS for all ships is not available in the same unrestricted way as OpenSky aircraft data.
- Fuel burn and CO2 values are estimated, not certified measurements.

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run start
npm run pm2:start
npm run pm2:restart
npm run pm2:stop
npm run pm2:delete
npm run pm2:status
npm run pm2:logs
python3 current_aircraft_count.py --raw
```

## License

This repository is currently configured with `ISC` in `package.json`.
