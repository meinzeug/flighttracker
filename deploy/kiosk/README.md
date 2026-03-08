# Kiosk / USB Start

Dieses Verzeichnis ist die lokale Betriebsbasis fuer einen einfachen Linux-Kioskstart.

## Was enthalten ist

- `start-flighttracker.sh`
  - startet den lokalen PM2-Stack
  - oeffnet danach `http://localhost:3000`
- `flighttracker-kiosk.desktop`
  - Desktop-Entry fuer einen lokalen Autostart oder Launcher

## Typischer Einsatz

1. Repository auf das Zielsystem oder einen Live-USB kopieren.
2. `npm install` im Projekt ausfuehren.
3. Optional PayPal- und Server-Umgebungsvariablen setzen.
4. `deploy/kiosk/flighttracker-kiosk.desktop` in den Autostart oder auf den Desktop legen.

## Hinweis

Die Datei ist bewusst nur ein lokales Startprofil. Ein vollwertiges haertendes USB-Image mit verschluesseltem Persistenzspeicher, BIOS/UEFI-Hardening und Offline-Updatepfad ist ein eigener Ausbauschritt.
