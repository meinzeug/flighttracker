#!/usr/bin/env python3
"""Print the current number of aircraft airborne worldwide from OpenSky."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, UTC
from typing import Any
from urllib import error, request


API_URL = "https://opensky-network.org/api/states/all"


def fetch_states(timeout: float, token: str | None = None) -> dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "User-Agent": "flighttracker/1.0 (+https://opensky-network.org)",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = request.Request(
        API_URL,
        headers=headers,
    )
    with request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def count_airborne_aircraft(payload: dict[str, Any]) -> int:
    airborne: set[str] = set()
    for state in payload.get("states") or []:
        if not isinstance(state, list) or len(state) <= 8:
            continue

        icao24 = state[0]
        on_ground = state[8]
        if isinstance(icao24, str) and on_ground is False:
            airborne.add(icao24.strip().lower())

    return len(airborne)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Gibt die aktuelle Anzahl der laut OpenSky weltweit in der Luft "
            "erfassten Flugzeuge aus."
        )
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Nur die Zahl ausgeben.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=20.0,
        help="HTTP-Timeout in Sekunden (Standard: 20).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        payload = fetch_states(
            timeout=args.timeout,
            token=os.environ.get("OPENSKY_TOKEN"),
        )
    except error.HTTPError as exc:
        print(
            f"OpenSky-HTTP-Fehler: {exc.code} {exc.reason}",
            file=sys.stderr,
        )
        return 1
    except error.URLError as exc:
        print(f"Netzwerkfehler: {exc.reason}", file=sys.stderr)
        return 1
    except TimeoutError:
        print("Zeitüberschreitung beim Abruf von OpenSky.", file=sys.stderr)
        return 1
    except json.JSONDecodeError:
        print("OpenSky hat keine gueltige JSON-Antwort geliefert.", file=sys.stderr)
        return 1

    count = count_airborne_aircraft(payload)
    timestamp = payload.get("time")

    if args.raw:
        print(count)
        return 0

    if isinstance(timestamp, int):
        observed_at = datetime.fromtimestamp(timestamp, tz=UTC).isoformat()
    else:
        observed_at = datetime.now(tz=UTC).isoformat()

    print(
        f"{count} Flugzeuge aktuell in der Luft "
        f"(OpenSky-Sicht, Zeitpunkt {observed_at})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
