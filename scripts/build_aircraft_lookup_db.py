#!/usr/bin/env python3

from __future__ import annotations

import csv
import sqlite3
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: build_aircraft_lookup_db.py <csv_path> <db_path>", file=sys.stderr)
        return 1

    csv_path = Path(sys.argv[1])
    db_path = Path(sys.argv[2])
    tmp_path = db_path.with_suffix(".tmp")

    db_path.parent.mkdir(parents=True, exist_ok=True)
    if tmp_path.exists():
        tmp_path.unlink()

    connection = sqlite3.connect(tmp_path)
    connection.execute("PRAGMA journal_mode = OFF")
    connection.execute("PRAGMA synchronous = OFF")
    connection.execute("PRAGMA temp_store = MEMORY")
    connection.execute("PRAGMA cache_size = -200000")
    connection.execute(
        """
        CREATE TABLE aircraft (
            icao24 TEXT PRIMARY KEY,
            registration TEXT,
            manufacturer_name TEXT,
            model TEXT,
            typecode TEXT,
            category_description TEXT,
            operator TEXT,
            operator_callsign TEXT,
            operator_iata TEXT,
            operator_icao TEXT,
            owner TEXT,
            country TEXT,
            engines TEXT,
            icao_aircraft_class TEXT,
            registered TEXT,
            built TEXT
        )
        """
    )

    batch: list[tuple[str, ...]] = []
    insert_sql = """
        INSERT OR REPLACE INTO aircraft (
            icao24, registration, manufacturer_name, model, typecode,
            category_description, operator, operator_callsign, operator_iata,
            operator_icao, owner, country, engines, icao_aircraft_class,
            registered, built
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, quotechar="'")
        for row in reader:
            icao24 = (row.get("icao24") or "").strip().lower()
            if not icao24:
                continue

            batch.append(
                (
                    icao24,
                    (row.get("registration") or "").strip() or None,
                    (row.get("manufacturerName") or "").strip() or None,
                    (row.get("model") or "").strip() or None,
                    (row.get("typecode") or "").strip().upper() or None,
                    (row.get("categoryDescription") or "").strip() or None,
                    (row.get("operator") or "").strip() or None,
                    (row.get("operatorCallsign") or "").strip() or None,
                    (row.get("operatorIata") or "").strip() or None,
                    (row.get("operatorIcao") or "").strip() or None,
                    (row.get("owner") or "").strip() or None,
                    (row.get("country") or "").strip() or None,
                    (row.get("engines") or "").strip() or None,
                    (row.get("icaoAircraftClass") or "").strip() or None,
                    (row.get("registered") or "").strip() or None,
                    (row.get("built") or "").strip() or None,
                )
            )

            if len(batch) >= 10000:
                connection.executemany(insert_sql, batch)
                batch.clear()

    if batch:
        connection.executemany(insert_sql, batch)

    connection.commit()
    connection.execute("CREATE INDEX idx_aircraft_typecode ON aircraft(typecode)")
    connection.commit()
    connection.execute("VACUUM")
    connection.close()

    if db_path.exists():
        db_path.unlink()
    tmp_path.rename(db_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
