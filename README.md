# FlightTracker

Live-Flugradar mit OpenSky, Typanalyse und einer transparenten Emissionsschaetzung fuer die aktuell sichtbare weltweite Flugflotte.

## Was das Projekt macht

- zeigt live die aktuell in der Luft erfassten Flugzeuge
- gruppiert nach Betriebssegmenten wie `Passenger`, `Cargo`, `Military / Government`, `Business / Private`, `Rotorcraft` und weiteren Klassen
- schaetzt pro Flugzeug und fuer die Gesamtflotte den momentanen Kerosinverbrauch sowie den direkten `CO2`-Ausstoss
- bietet ein Browser-Frontend mit Radar-Look, interaktiver Weltkarte und Filterleisten
- laeuft lokal mit `npm run dev` auf Port `6666`

## Stack

- Frontend: `React` + `Vite`
- Karten-/Radar-Layer: `MapLibre GL JS` + `deck.gl`
- Backend: `Express`
- Live-Daten: OpenSky `states/all?extended=1`
- Typ-/Metadaten: OpenSky Aircraft Database + DOC8643 Aircraft Types
- schneller Typ-Lookup: lokaler `SQLite`-Index, einmalig aus der OpenSky-CSV aufgebaut

## Schnellstart

### Voraussetzungen

- `Node.js 20+`
- `Python 3.11+` mit eingebautem `sqlite3`

### Starten

```bash
npm install
npm run dev
```

Danach:

- Frontend: `http://localhost:6666`
- API: `http://localhost:6667`

## Wichtige Scripts

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
pm2 logs
python3 current_aircraft_count.py --raw
```

## PM2

Der lokale Entwicklungsstack ist direkt mit PM2 managebar.

```bash
npm run pm2:start
npm run pm2:status
npm run pm2:restart
npm run pm2:stop
npm run pm2:delete
```

Gestartet werden zwei Prozesse:

- `flighttracker-web` auf `http://localhost:6666`
- `flighttracker-api` auf `http://localhost:6667`

Die Konfiguration liegt in `ecosystem.config.cjs`.

## Umgebungsvariablen

```bash
OPENSKY_TOKEN=dein_token
CLIENT_PORT=6666
SERVER_PORT=6667
LIVE_CACHE_TTL_MS=30000
AIRCRAFT_DB_URL=https://s3.opensky-network.org/data-samples/metadata/aircraft-database-complete-2024-10.csv
DOC8643_URL=https://s3.opensky-network.org/data-samples/metadata/doc8643AircraftTypes.csv
```

## Datenfluss

1. Der Server zieht Live-State-Vektoren von OpenSky.
2. Er filtert auf Flugzeuge in der Luft (`on_ground = false`).
3. Fuer unbekannte `icao24`-Kennungen werden Typ- und Betreiberinfos aus einem lokalen SQLite-Lookup gelesen.
4. Die App klassifiziert jedes Flugzeug heuristisch in ein Betriebssegment.
5. Ein Schaetzmodell berechnet daraus `fuel kg/h`, `fuel L/h` und `CO2 kg/h`.
6. Das Frontend visualisiert die Flotte als Radar-Karte, Scope und Analyse-Dashboard.

## Fachliche Hinweise

Diese App ist bewusst eine Live-Schaetzung und kein zertifiziertes Emissionsinventar.

- OpenSky deckt nicht jedes einzelne Flugzeug weltweit perfekt ab.
- Die Typauflosung ist so gut wie die verknuepfte OpenSky Aircraft Database.
- `Fuel` und `CO2` werden heuristisch aus Typcode, Motorart, Anzahl Triebwerke, Wake-Klasse, Geschwindigkeit, Hoehe und Betriebssegment abgeleitet.
- `CO2` basiert auf der Faustformel `3.16 kg CO2 pro kg verbranntem Kerosin`.
- Literwerte werden mit rund `0.8 kg/L` umgerechnet.

## Repo-Struktur

```text
server/          Express API, Live-Daten, Klassifikation, Emissionsmodell
src/             React-Frontend, Radar-Karte, Radar-Scope, Dashboard
scripts/         Hilfsskripte, z.B. Aufbau des SQLite-Lookups
data/cache/      lokal erzeugte Metadaten-Caches (gitignored)
current_aircraft_count.py
```

## Quellen

- OpenSky REST API: `https://opensky-network.org/api/states/all`
- OpenSky REST-Doku: `https://openskynetwork.github.io/opensky-api/rest.html`
- OpenSky Metadata Bucket: `https://s3.opensky-network.org/data-samples/metadata/`
- MapLibre GL JS: `https://maplibre.org/maplibre-gl-js/docs/`
- deck.gl: `https://deck.gl/docs`

## Status

Das Projekt ist auf lokale Exploration, Visualisierung und Monitoring ausgelegt. Fuer belastbare Klima- oder Compliance-Berichte sollten die heuristischen Werte nicht ungeprueft uebernommen werden.
