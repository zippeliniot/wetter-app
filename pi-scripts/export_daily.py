#!/usr/bin/env python3
"""export_daily.py — Tages-min/max/mittel -> Monatsdateien auf SFTP.

Modi:
  (ohne Argument)     Tageswerte fuer GESTERN in die aktuelle Monatsdatei
                      (systemd-Timer, taeglich 00:05)
  --backfill          alle Monate ab 2023-06 bis heute nachholen,
                      je eine months/<YYYY-MM>.json
  --month YYYY-MM     genau diesen Monat komplett neu aufbauen

Logiksensoren (union ueber Measurement-Varianten, SENSOR_MEASUREMENTS):
  sw40 : Seewasser 40 cm      swgr : Seewasser Grund
  at   : Aussentemperatur     ah   : Aussenluftfeuchte

Zeitbasis Europe/Berlin. Vorhandene Tageswerte in der Monatsdatei bleiben
erhalten und werden nur ueberschrieben, wo InfluxDB einen neuen Wert liefert.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import date, datetime, timedelta

from influxdb_client import InfluxDBClient

from climac_sftp import SENSOR_MEASUREMENTS, ClimacSFTP, get_influx_config

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, "logs", "export_daily.log")

BACKFILL_START = (2023, 6)

# Reihenfolge = Spaltenreihenfolge in der Monatsdatei
SENSORS = {key: SENSOR_MEASUREMENTS[key] for key in ("sw40", "swgr", "at", "ah")}

COLS = ["d"]
for _key in SENSORS:
    COLS += [f"{_key}_min", f"{_key}_max", f"{_key}_mean"]

log = logging.getLogger("export_daily")


def setup_logging() -> None:
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    log.setLevel(logging.INFO)
    fh = logging.FileHandler(LOG_FILE)
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    log.addHandler(fh)
    log.addHandler(sh)


def _round1(v):
    return None if v is None else round(float(v), 1)


def _next_month(y: int, m: int) -> tuple[int, int]:
    return (y + 1, 1) if m == 12 else (y, m + 1)


def iter_months(start: tuple[int, int], end: tuple[int, int]):
    y, m = start
    while (y, m) <= end:
        yield y, m
        y, m = _next_month(y, m)


def _flux(measurements: list[str], year: int, month: int, only_day: int | None) -> str:
    mfilter = " or ".join(f'r._measurement == "{m}"' for m in measurements)
    m_start = date(year, month, 1)
    ny, nm = _next_month(year, month)
    range_start = (m_start - timedelta(days=1)).isoformat() + "T00:00:00Z"
    range_stop = (date(ny, nm, 1) + timedelta(days=1)).isoformat() + "T00:00:00Z"
    day_clause = f" and r.d == {only_day}" if only_day else ""

    def agg(fn: str) -> str:
        return (
            f'  data |> aggregateWindow(every: 1d, fn: {fn}, createEmpty: false, '
            f'timeSrc: "_start")\n'
            f'    |> map(fn: (r) => ({{ d: date.monthDay(t: r._time), '
            f'yr: date.year(t: r._time), mo: date.month(t: r._time), '
            f's: "{fn}", v: r._value }}))'
        )

    return f'''
import "date"
import "timezone"
option location = timezone.location(name: "Europe/Berlin")

data = from(bucket: "{INFLUX["bucket"]}")
  |> range(start: {range_start}, stop: {range_stop})
  |> filter(fn: (r) => r._field == "value" and ({mfilter}))
  |> group()

union(tables: [
{agg("min")},
{agg("max")},
{agg("mean")},
])
  |> filter(fn: (r) => r.yr == {year} and r.mo == {month}{day_clause})
  |> filter(fn: (r) => exists r.v)
  |> keep(columns: ["d", "s", "v"])
'''


def fetch_month(client: InfluxDBClient, year: int, month: int,
                only_day: int | None = None) -> dict:
    """-> { day(int): { 'sw40_min': float|None, ... } }"""
    cells_by_day: dict[int, dict] = {}
    for key, measurements in SENSORS.items():
        tables = client.query_api().query(
            _flux(measurements, year, month, only_day), org=INFLUX["org"]
        )
        for table in tables:
            for rec in table.records:
                day = int(rec["d"])
                col = f'{key}_{rec["s"]}'
                cells_by_day.setdefault(day, {})[col] = _round1(rec["v"])
    return cells_by_day


def _row_to_cells(row: list) -> dict:
    return {COLS[i]: row[i] for i in range(min(len(row), len(COLS)))}


def _cells_to_row(cells: dict) -> list:
    return [cells.get(c) for c in COLS]


def merge_month(existing: dict, month_key: str, new_cells: dict) -> dict:
    cells_by_day: dict[int, dict] = {}
    for row in existing.get("data", []):
        if row:
            cells_by_day[int(row[0])] = _row_to_cells(row)

    for day, cells in new_cells.items():
        base = cells_by_day.setdefault(day, {})
        base["d"] = day
        for col, val in cells.items():
            if val is not None:
                base[col] = val

    data = [_cells_to_row(cells_by_day[d]) for d in sorted(cells_by_day)]
    return {"m": month_key, "cols": COLS, "data": data}


def load_remote_month(sftp: ClimacSFTP, month_key: str, local_path: str) -> dict:
    if sftp.download_file(f"{month_key}.json", local_path, subdir="months"):
        try:
            with open(local_path) as fh:
                doc = json.load(fh)
            return doc
        except (ValueError, OSError):
            log.warning("%s.json defekt/unlesbar -> wird neu aufgebaut", month_key)
    return {"m": month_key, "cols": COLS, "data": []}


def process_month(client: InfluxDBClient, sftp: ClimacSFTP, year: int, month: int,
                  only_day: int | None = None) -> str:
    month_key = f"{year:04d}-{month:02d}"
    tmp_path = f"/tmp/climac_{month_key}.json"
    scope = f"Tag {only_day}" if only_day else "ganzer Monat"

    new_cells = fetch_month(client, year, month, only_day)
    if not new_cells:
        log.info("%s (%s): keine InfluxDB-Daten -> uebersprungen", month_key, scope)
        return "skipped"

    existing = load_remote_month(sftp, month_key, tmp_path)
    before = len(existing.get("data", []))
    doc = merge_month(existing, month_key, new_cells)
    after = len(doc["data"])

    with open(tmp_path, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"), allow_nan=False)
    remote = sftp.upload_file(tmp_path, f"{month_key}.json", subdir="months")

    log.info("%s (%s): %d -> %d Tage, %d Bytes -> %s",
             month_key, scope, before, after, os.path.getsize(tmp_path), remote)
    return "created" if before == 0 else "updated"


def parse_args(argv) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Tages-Export Seewasser/Wetter -> SFTP")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--backfill", action="store_true",
                   help="alle Monate ab 2023-06 bis heute nachholen")
    g.add_argument("--month", metavar="YYYY-MM",
                   help="genau diesen Monat komplett neu aufbauen")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv or sys.argv[1:])
    setup_logging()
    log.info("=== export_daily start (%s) ===",
             "backfill" if args.backfill else args.month or "gestern")
    try:
        with InfluxDBClient(url=INFLUX["url"], token=INFLUX["token"],
                            org=INFLUX["org"], timeout=180_000) as client, \
                ClimacSFTP() as sftp:

            if args.backfill:
                today = date.today()
                stats = {"created": 0, "updated": 0, "skipped": 0}
                for y, m in iter_months(BACKFILL_START, (today.year, today.month)):
                    stats[process_month(client, sftp, y, m)] += 1
                log.info("Backfill fertig: %d neu, %d aktualisiert, %d leer/uebersprungen",
                         stats["created"], stats["updated"], stats["skipped"])

            elif args.month:
                y, m = (int(x) for x in args.month.split("-"))
                process_month(client, sftp, y, m)

            else:
                yesterday = datetime.now() - timedelta(days=1)
                process_month(client, sftp, yesterday.year, yesterday.month,
                              only_day=yesterday.day)

        log.info("=== export_daily done ===")
        return 0
    except Exception:
        log.exception("export_daily FEHLGESCHLAGEN")
        return 1


INFLUX = get_influx_config()

if __name__ == "__main__":
    sys.exit(main())
