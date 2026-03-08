# Flight Tracker

Ein kleines Skript, das die aktuell von OpenSky weltweit in der Luft
erfassten Flugzeuge zählt.

## Start

```bash
python3 current_aircraft_count.py
```

Nur die nackte Zahl:

```bash
python3 current_aircraft_count.py --raw
```

Optional mit Bearer-Token:

```bash
OPENSKY_TOKEN=dein_token python3 current_aircraft_count.py
```

## Hinweis

Die Ausgabe ist eine Live-Annäherung auf Basis der von OpenSky
empfangenen ADS-B/Mode-S-Daten. Sie ist praktisch nutzbar, aber nicht
garantiert die exakte physische Gesamtzahl aller Flugzeuge weltweit.
