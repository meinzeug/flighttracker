# Public Data Graph Architecture

Stand: 2026-03-08

## Ziel

WhatsUpp soll von einem Flug-Radar zu einem allgemeinen Open-Data-Lagebild wachsen:

- Luftfahrt
- Schifffahrt
- Energie / Strom / Gas
- Wetter / Umwelt / Ereignisse
- Infrastruktur / Karten / Referenzdaten

## Harte Grenze

Ein echter, globaler, frei oeffentlicher Live-Feed fuer "alle Schiffe" ist in der Praxis nicht so offen verfuegbar wie OpenSky fuer Flugzeuge. Deshalb ist die saubere Strategie:

1. offene maritime Karten- und Hafendaten sofort
2. oeffentliche bzw. registrierbare AIS-/Vessel-APIs modular
3. historische oder regionale AIS-Daten als Backfill

## Empfohlene Datenquellen

### Luftfahrt

- OpenSky: Live-Fluege, Tracks, Metadaten
- openAIP: Luftraeume, Flugplaetze, Navaids

### Schifffahrt

- Global Fishing Watch: Vessel presence, fishing effort, port visits, detections
- NOAA Marine Cadastre: historische US-AIS-Daten
- OpenSeaMap: maritime Referenz- und Seamark-Layer
- NGA World Port Index: Hafenreferenzen

### Strom / Energie

- ENTSO-E: Last, Erzeugung, Ausfaelle, Fluesse
- EIA: Storage, Power, Fuels, Preise, Serien
- Open Infrastructure Map / OSM: Leitungen, Umspannwerke, Masten

### Gas

- ENTSOG Transparency: Fluesse, Transmission, Kapazitaeten
- GIE AGSI+ / ALSI: Speicher- und LNG-Status
- OSM / Overpass: Pipelines, Terminals, Stations

### Wetter / Umwelt

- Open-Meteo: schnelles Punktwetter
- NOAA / NWS: Wetterwarnungen, Beobachtungen, Forecasts
- NASA FIRMS: Feuer-Hotspots
- USGS: Erdbeben-Feeds

### Karten / GIS

- OpenStreetMap / Overpass
- OpenTopoMap
- NOAA ENC

## Technische Zielarchitektur

Die richtige "Graph"-Loesung ist nicht nur ein einzelner Graph-Store. Fuer fluessige Karten und viele Datenarten braucht das System drei Ebenen:

### 1. Ingest / Normalisierung

- Worker pro Quelle
- rohe Quelldaten in `raw_*` Tabellen speichern
- normalisierte Entities bilden:
  - `aircraft`
  - `vessel`
  - `port`
  - `airport`
  - `power_line`
  - `substation`
  - `pipeline`
  - `gas_storage`
  - `weather_cell`
  - `event`

### 2. Geospatial Graph Core

Empfohlen:

- `PostgreSQL + PostGIS` als Hauptspeicher
- `Apache AGE` auf PostgreSQL oder alternativ `Neo4j` fuer Relationen

Warum:

- Geometrien, Bounding-Boxen, Intersections und Tiles sind in PostGIS stark
- Netzbeziehungen wie `connected_to`, `owned_by`, `feeds`, `near`, `crosses`, `serves` passen in einen Graph

Beispielkanten:

- `airport -> served_by -> power_substation`
- `vessel -> entered -> port`
- `pipeline -> connected_to -> gas_storage`
- `aircraft -> operated_by -> operator`
- `power_line -> crosses -> border`
- `event -> impacts -> infrastructure_asset`

### 3. Delivery Layer

- Vector Tiles fuer grosse statische Daten
- Aggregations-Tiles / Heatmap-Tiles fuer hohe Punktdichten
- kleine Live-Targets separat streamen

Empfohlen:

- `Martin` oder `Tegola` fuer Vector Tiles aus PostGIS
- API fuer Live-Targets, Filter und Graph-Abfragen
- spaeter WebSocket / SSE fuer Live-Layer

## Frontend-Strategie

Fuer die naechste Ausbaustufe:

- `MapLibre` als Basis beibehalten
- grosse Infrastruktur-Layer als Vector Tiles
- Live-Flugzeuge und spaeter Schiffe weiterhin als eigener GPU-/Canvas-Layer
- fuer grosse Punktwolken perspektivisch `deck.gl`
- Layer Registry mit Kategorien, Sichtbarkeit, Stil und Datenstatus
- Query-Panel fuer "nahe Assets", "verbundene Netze", "Interaktionen"

## Performance-Regeln

- keine kompletten GeoJSON-Welten in den Browser laden
- alles Groeßere als Tile oder serverseitig aggregierte Fenster liefern
- Live-Targets nur im aktuellen Viewport und mit Zoom-Budget
- Worker fuer Parsing und Normierung
- Heatmaps und Cluster serverseitig oder in WebGL

## Praktischer Rollout

### Phase 1

- Open Data Catalog im UI
- maritime Referenzdaten
- Wetter, Ereignisse, Feuer, Erdbeben
- Presets / Layer Registry / Export

### Phase 2

- Strom- und Gasinfrastruktur als echte Tile-Layer
- Energie-Dashboard mit Zeitreihen
- Hafen- und Terminal-Layer

### Phase 3

- AIS-/Vessel-Quelle mit Token oder Community-Zugang
- Graph-Abfragen ueber Infrastruktur und Ereignisse
- Cross-domain-Lagebild:
  - Flug + Schiff + Energie + Wetter + Ereignisse

## Fazit

Die beste technische Loesung ist:

- `PostGIS` fuer Geodaten und Tiles
- zusaetzlicher Graph-Layer fuer Beziehungen
- MapLibre + spaeter `deck.gl` fuer Rendering
- modulare Quellen, damit nicht jede API den ganzen Stack blockiert
