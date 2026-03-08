# Kiosk / Desktop Launch

This folder contains the local launch helpers for running `whatsupp` as a desktop or kiosk-style console.

## Included Files

- `start-whatsupp.sh`
  - starts or restarts the PM2 stack
  - opens `http://localhost:23666`
- `whatsupp-kiosk.desktop`
  - desktop entry for autostart or manual launcher placement

## Typical Setup

1. Copy the repository to the target machine.
2. Run `npm install`.
3. Ensure the PM2 ports in `ecosystem.config.cjs` fit the target environment.
4. Place `deploy/kiosk/whatsupp-kiosk.desktop` into autostart or onto the desktop.

## Operational Note

This is a lightweight local launch profile. A hardened kiosk image with locked-down browser policy, encrypted persistence, controlled updates, and dedicated device management is a separate deployment step.
