#!/usr/bin/env python3
"""export_daily.py — Tages-min/max/mittel (GESTERN) -> Monatsdatei auf SFTP.

Laeuft taeglich 00:05.

Sensoren (Tageswerte fuer gestern, lokale Zeit Europe/Berlin):
  sw40 : sensor.seewasser_temp_101_40cm
  swgr : sensor.seewasser_temp_102_grund_2
  at   : sensor.gw2000a_outdoor_temperature
  ah   : sensor.gw2000a_humidity

Ablauf:
  1. Monatsdatei months/<YYYY-MM>.json vom SFTP laden (falls vorhanden)
  2. Zeile fuer gestrigen Tag ergaenzen/ersetzen
  3. /tmp/climac_<YYYY-MM>.json schreiben -> Upload months/<YYYY-MM>.json
"""
from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timedelta

from influxdb_client import InfluxDBClient

from climac_sftp import ClimacSFTP, get_influx_config

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, "logs", "export_daily.log")

# Reihenfolge = Spaltenreihenfolge in der Monatsdatei
SENSORS = {
    "sw40": "sensor.seewasser_temp_101_40cm",
    "swgr": "sensor.seewasser_temp_102_grund_2",
    "at": "sensor.gw2000a_outdoor_temperature",
    "ah": "sensor.gw2000a_humidity",
}

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


def _flux(measurement: str) -> str:
    return f'''
import "date"
import "timezone"
option location = timezone.location(name: "Europe/Berlin")

today = date.truncate(t: now(), unit: 1d)
yesterday = date.sub(d: 1d, from: today)

data = from(bucket: "{INFLUX["bucket"]}")
  |> range(start: yesterday, stop: today)
  |> filter(fn: (r) => r._field == "value" and r._measurement == "{measurement}")

union(tables: [
  data |> min()  |> map(fn: (r) => ({{ stat: "min",  v: r._value }})),
  data |> max()  |> map(fn: (r) => ({{ stat: "max",  v: r._value }})),
  data |> mean() |> map(fn: (r) => ({{ stat: "mean", v: r._value }})),
])
  |> keep(columns: ["stat", "v"])
'''


def query_day(client: InfluxDBClient, measurement: str) -> dict:
    stats = {"min": None, "max": None, "mean": None}
    tables = client.query_api().query(_flux(measurement), org=INFLUX["org"])
    for table in tables:
        for rec in table.records:
            stats[rec["stat"]] = rec["v"]
    return stats


def build_row(client: InfluxDBClient, day: int) -> list:
    row: list = [day]
    for key, measurement in SENSORS.items():
        s = query_day(client, measurement)
        row += [_round1(s["min"]), _round1(s["max"]), _round1(s["mean"])]
        log.info("%-5s min=%s max=%s mean=%s", key, *[
            "-" if s[k] is None else round(s[k], 2) for k in ("min", "max", "mean")
        ])
    return row


def load_month(month_key: str, local_path: str) -> dict:
    with ClimacSFTP() as s:
        found = s.download_file(f"{month_key}.json", local_path, subdir="months")
    if found:
        try:
            doc = json.load(open(local_path))
            log.info("bestehende Monatsdatei: %d Tage", len(doc.get("data", [])))
            return doc
        except (ValueError, OSError):
            log.warning("Monatsdatei defekt/unlesbar -> wird neu aufgebaut")
    else:
        log.info("keine bestehende Monatsdatei -> neu")
    return {"m": month_key, "cols": COLS, "data": []}


def upsert_row(doc: dict, row: list) -> None:
    doc["cols"] = COLS
    day = row[0]
    data = [r for r in doc.get("data", []) if r and r[0] != day]
    data.append(row)
    data.sort(key=lambda r: r[0])
    doc["data"] = data


def main() -> int:
    setup_logging()
    log.info("=== export_daily start ===")
    try:
        yesterday = datetime.now() - timedelta(days=1)
        month_key = yesterday.strftime("%Y-%m")
        day = yesterday.day
        log.info("Zieltag: %s (Tag %d, Monat %s)",
                 yesterday.strftime("%Y-%m-%d"), day, month_key)

        tmp_path = f"/tmp/climac_{month_key}.json"
        doc = load_month(month_key, tmp_path)
        doc["m"] = month_key

        with InfluxDBClient(url=INFLUX["url"], token=INFLUX["token"],
                            org=INFLUX["org"], timeout=120_000) as client:
            row = build_row(client, day)

        upsert_row(doc, row)

        with open(tmp_path, "w") as fh:
            json.dump(doc, fh, separators=(",", ":"), allow_nan=False)
        log.info("geschrieben: %s (%d Tage, %d Bytes)",
                 tmp_path, len(doc["data"]), os.path.getsize(tmp_path))

        with ClimacSFTP() as s:
            remote = s.upload_file(tmp_path, f"{month_key}.json", subdir="months")
        log.info("Upload OK -> %s", remote)
        log.info("=== export_daily done ===")
        return 0
    except Exception:
        log.exception("export_daily FEHLGESCHLAGEN")
        return 1


INFLUX = get_influx_config()

if __name__ == "__main__":
    sys.exit(main())
