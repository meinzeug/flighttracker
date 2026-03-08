# FlightTracker

Geschuetztes, mobiles Live-Radar fuer globale Fluglagen mit Typanalyse, Emissionsschaetzung, Watchlists, Playback und optionaler PayPal-Monetarisierung.

## Produktbild

FlightTracker ist kein statisches Dashboard mehr, sondern ein lokales Radarprodukt:

- mobile-first Frontend mit grosser Live-Karte und taktischem Sidepanel
- Login-Gate vor der Live-API
- Admin-Bootstrap direkt ueber die Weboberflaeche beim ersten Start
- Live-Fluglage mit Radar-Scope, Zielauswahl und Watchlist-Alerts
- Typ-, Segment- und Emissionsanalyse auf Basis der aktuellen OpenSky-Daten
- Saved Views und serverseitig gepufferter Playback-Verlauf
- optionaler PayPal-Checkout fuer einen direkten Support- oder Command-Pass-Verkauf
- PM2- und Kiosk-Basis fuer lokale Desktop- oder USB-Deployments

## Stack

- Frontend: `React` + `Vite`
- Kartenbasis: `MapLibre GL JS`
- Flugdarstellung: eigene Canvas-Radar-Ebene
- Backend: `Express`
- Live-Daten: OpenSky `states/all?extended=1`
- Typ-/Metadaten: OpenSky Aircraft Database + DOC8643
- Lookup: lokaler `SQLite`-Index
- Prozessmanagement: `PM2`

## Schnellstart

### Voraussetzungen

- `Node.js 20+`
- `Python 3.11+` mit `sqlite3`

### Installation

```bash
npm install
npm run dev
```

Danach:

- Frontend: `http://localhost:3000`
- API: `http://localhost:3001`

## Erster Login

Beim ersten Start gibt es noch keinen Admin.

1. `http://localhost:3000` oeffnen
2. Benutzername und Passwort setzen
3. der erste Login legt den lokalen Admin-Zugang an
4. danach ist die Live-API nur noch mit Session erreichbar

Die Session wird als `HttpOnly`-Cookie gesetzt.

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
python3 current_aircraft_count.py --raw
```

## PM2

Der lokale Stack ist direkt mit PM2 managebar:

```bash
npm run pm2:start
npm run pm2:status
npm run pm2:restart
npm run pm2:stop
npm run pm2:delete
```

Prozesse:

- `flighttracker-web` auf `http://localhost:3000`
- `flighttracker-api` auf `http://localhost:3001`

## PayPal Monetarisierung

Die App kann eine echte PayPal-Checkout-Flaeche rendern, wenn der Server konfiguriert ist.

### Noetige Variablen

```bash
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=deine_paypal_client_id
PAYPAL_CLIENT_SECRET=dein_paypal_client_secret
PAYPAL_CURRENCY=EUR
PAYPAL_SUPPORT_AMOUNT=29.00
```

Ohne diese Werte bleibt der Support-/Checkout-Block sichtbar, aber deaktiviert.

Die Integration nutzt die aktuelle PayPal-JavaScript-SDK plus serverseitige Orders-v2-Erstellung und Capture-Endpunkte.

## Weitere Umgebungsvariablen

```bash
OPENSKY_TOKEN=dein_token
CLIENT_PORT=3000
SERVER_PORT=3001
LIVE_CACHE_TTL_MS=30000
SESSION_TTL_MS=604800000
AIRCRAFT_DB_URL=https://s3.opensky-network.org/data-samples/metadata/aircraft-database-complete-2024-10.csv
DOC8643_URL=https://s3.opensky-network.org/data-samples/metadata/doc8643AircraftTypes.csv
```

## Kiosk / USB Richtung

Unter `deploy/kiosk/` liegt eine lokale Startbasis:

- `start-flighttracker.sh`
- `flighttracker-kiosk.desktop`
- `deploy/kiosk/README.md`

Damit laesst sich das Produkt auf einem Linux-Desktop oder Live-System leicht als lokale Kiosk-App starten.

## Datenfluss

1. Der Server zieht Live-State-Vektoren von OpenSky.
2. Er filtert auf Flugzeuge in der Luft.
3. Der Lookup reichert Typ- und Betreiberinfos an.
4. Die App klassifiziert Flugzeuge in Segmente wie `Cargo`, `Passenger`, `Military / Government` oder `Business / Private`.
5. Das Emissionsmodell schaetzt `fuel L/h` und `CO2 kg/h`.
6. Das Frontend rendert Radar, Scope, Playback, Filter, Alerts und Checkout.

## Fachliche Hinweise

Die angezeigten Verbrauchs- und Emissionswerte sind heuristische Live-Schaetzungen.

- OpenSky erfasst nicht jedes Flugzeug weltweit perfekt.
- Die Typauflosung haengt von den verknuepften Metadaten ab.
- `CO2` basiert auf `3.16 kg CO2` pro `kg` verbranntem Kerosin.
- Literwerte werden mit rund `0.8 kg/L` umgerechnet.

## Repo-Struktur

```text
server/          Express API, Auth, Live-Daten, Emissionsmodell, PayPal
src/             React-Frontend, Radar-Karte, Scope, Produkt-UI
deploy/kiosk/    lokale Kiosk-/Desktop-Startbasis
scripts/         Hilfsskripte
data/cache/      lokal erzeugte Metadaten-Caches
current_aircraft_count.py
```

## Quellen

- OpenSky REST API: `https://opensky-network.org/api/states/all`
- OpenSky REST-Doku: `https://openskynetwork.github.io/opensky-api/rest.html`
- OpenSky Metadata Bucket: `https://s3.opensky-network.org/data-samples/metadata/`
- MapLibre GL JS: `https://maplibre.org/maplibre-gl-js/docs/`
- PayPal JavaScript SDK: `https://developer.paypal.com/sdk/js/`
- PayPal Orders v2 API: `https://developer.paypal.com/docs/api/orders/v2/`
