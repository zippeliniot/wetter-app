#!/usr/bin/env python3
"""export_history.py — Jahres-/DOY-Historie Seewassertemperatur -> SFTP.

Laeuft jaehrlich (01.01. 00:10) oder manuell.

Beide Logiksensoren werden per union() ueber ihre Measurement-Varianten
zusammengefuehrt (SENSOR_MEASUREMENTS in climac_sftp.py):
  SW40  : temperature_sensor_101_40_cm_temperature (alt) + seewasser_temp_101_40cm (neu)
          -> ab 2023-06-01
  SWGR  : temperature_sensor_102_grund_temperature (alt) + seewasser_temp_102_grund*
          -> ab erstem verfuegbaren Datum (weiter Startpunkt, leere Jahre entfallen)
  AT    : gw2000a_outdoor_temperature (Aussentemperatur)
          -> ab erstem verfuegbaren Datum

Gruppierung: Jahr -> DOY (1..365), Tagesmittel.
DOY-Referenzkurve + Sommer-Schwelle kommen aus SQLite.

Ausgabe /tmp/climac_history.json  ->  Upload data/history.json
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import sys
from datetime import datetime

from influxdb_client import InfluxDBClient

from climac_sftp import DB_PATH, SENSOR_MEASUREMENTS, ClimacSFTP, get_influx_config

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, "logs", "export_history.log")
OUT_FILE = "/tmp/climac_history.json"
REMOTE_NAME = "history.json"

# SW40 laut Vorgabe ab 2023-06-01; SWGR "ab erstem verfuegbaren Datum" ->
# weiter Startpunkt, Jahre ohne Daten tauchen im Ergebnis nicht auf.
SW40_START = "2023-06-01T00:00:00Z"
SWGR_START = "2015-01-01T00:00:00Z"
AT_START = "2015-01-01T00:00:00Z"

SW40_MEASUREMENTS = SENSOR_MEASUREMENTS["sw40"]
SWGR_MEASUREMENTS = SENSOR_MEASUREMENTS["swgr"]
AT_MEASUREMENTS = SENSOR_MEASUREMENTS["at"]

ML_ROLE = "sea_water"
DEFAULT_SUMMER_THRESHOLD = 18.0

log = logging.getLogger("export_history")


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


def _flux(measurements: list[str], start: str) -> str:
    mfilter = " or ".join(f'r._measurement == "{m}"' for m in measurements)
    return f'''
import "date"
import "timezone"
option location = timezone.location(name: "Europe/Berlin")

from(bucket: "{INFLUX["bucket"]}")
  |> range(start: {start})
  |> filter(fn: (r) => r._field == "value" and ({mfilter}))
  |> group()
  |> aggregateWindow(every: 1d, fn: mean, createEmpty: false, timeSrc: "_start")
  |> filter(fn: (r) => exists r._value)
  |> map(fn: (r) => ({{ y: date.year(t: r._time), d: date.yearDay(t: r._time), v: r._value }}))
  |> keep(columns: ["y", "d", "v"])
'''


def query_years(client: InfluxDBClient, measurements: list[str], start: str) -> dict:
    """-> { "2023": [365 floats|null], ... }"""
    tables = client.query_api().query(_flux(measurements, start), org=INFLUX["org"])
    per_year: dict[str, list] = {}
    for table in tables:
        for rec in table.records:
            year = str(int(rec["y"]))
            doy = int(rec["d"])
            if doy < 1 or doy > 365:
                continue
            arr = per_year.setdefault(year, [None] * 365)
            arr[doy - 1] = round(float(rec["v"]), 2)
    return {y: per_year[y] for y in sorted(per_year)}


def _flux_monthly(measurements: list[str], start: str, fn: str) -> str:
    mfilter = " or ".join(f'r._measurement == "{m}"' for m in measurements)
    return f'''
import "date"
import "timezone"
option location = timezone.location(name: "Europe/Berlin")

from(bucket: "{INFLUX["bucket"]}")
  |> range(start: {start})
  |> filter(fn: (r) => r._field == "value" and ({mfilter}))
  |> group()
  |> aggregateWindow(every: 1mo, fn: {fn}, createEmpty: false, timeSrc: "_start")
  |> filter(fn: (r) => exists r._value)
  |> map(fn: (r) => ({{ y: date.year(t: r._time), mo: date.month(t: r._time), v: r._value }}))
  |> keep(columns: ["y", "mo", "v"])
'''


def query_months(client: InfluxDBClient, measurements: list[str], start: str) -> dict:
    """-> { "2024": {"min":[12], "max":[12], "avg":[12]}, ... }  (null = kein Wert)"""
    out: dict[str, dict] = {}
    for fn, key in (("min", "min"), ("max", "max"), ("mean", "avg")):
        tables = client.query_api().query(
            _flux_monthly(measurements, start, fn), org=INFLUX["org"]
        )
        for table in tables:
            for rec in table.records:
                year = str(int(rec["y"]))
                mo = int(rec["mo"])
                if mo < 1 or mo > 12:
                    continue
                yd = out.setdefault(
                    year, {"min": [None] * 12, "max": [None] * 12, "avg": [None] * 12}
                )
                yd[key][mo - 1] = round(float(rec["v"]), 2)
    return {y: out[y] for y in sorted(out)}


def load_reference() -> tuple[list, float]:
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute(
            "SELECT doy, value FROM ml_doy_curves WHERE role = ? ORDER BY doy",
            (ML_ROLE,),
        ).fetchall()
        thr_row = conn.execute(
            "SELECT threshold_min FROM ml_sensor_roles WHERE id = ?", (ML_ROLE,)
        ).fetchone()
    finally:
        conn.close()

    ref: list = [None] * 365
    for doy, value in rows:
        if 1 <= int(doy) <= 365:
            ref[int(doy) - 1] = round(float(value), 2)

    threshold = DEFAULT_SUMMER_THRESHOLD
    if thr_row and thr_row[0] is not None:
        threshold = float(thr_row[0])
    return ref, threshold


def main() -> int:
    setup_logging()
    log.info("=== export_history start ===")
    try:
        ref, summer_threshold = load_reference()
        log.info("Referenz: %d/365 DOY-Werte, summer_threshold=%.1f",
                 sum(1 for x in ref if x is not None), summer_threshold)

        with InfluxDBClient(url=INFLUX["url"], token=INFLUX["token"],
                            org=INFLUX["org"], timeout=120_000) as client:
            sw40 = query_years(client, SW40_MEASUREMENTS, SW40_START)
            swgr = query_years(client, SWGR_MEASUREMENTS, SWGR_START)
            at = query_years(client, AT_MEASUREMENTS, AT_START)
            at_monthly = query_months(client, AT_MEASUREMENTS, AT_START)

        payload = {
            "updated": datetime.now().strftime("%Y-%m-%d"),
            "summer_threshold": summer_threshold,
            "ref": ref,
            "years": {"sw40": sw40, "swgr": swgr, "at": at},
            "at_monthly": at_monthly,
        }
        with open(OUT_FILE, "w") as fh:
            json.dump(payload, fh, separators=(",", ":"), allow_nan=False)

        def _summary(years: dict) -> str:
            return ", ".join(
                f"{y}:{sum(1 for v in vals if v is not None)}d"
                for y, vals in years.items()
            ) or "-"

        log.info("sw40 %s", _summary(sw40))
        log.info("swgr %s", _summary(swgr))
        log.info("at   %s", _summary(at))
        log.info("at_monthly %s", ", ".join(
            f"{y}:{sum(1 for v in md['min'] if v is not None)}mo"
            for y, md in at_monthly.items()) or "-")
        log.info("geschrieben: %s (%d Bytes)", OUT_FILE, os.path.getsize(OUT_FILE))

        with ClimacSFTP() as s:
            remote = s.upload_file(OUT_FILE, REMOTE_NAME)
        log.info("Upload OK -> %s", remote)
        log.info("=== export_history done ===")
        return 0
    except Exception:
        log.exception("export_history FEHLGESCHLAGEN")
        return 1


INFLUX = get_influx_config()

if __name__ == "__main__":
    sys.exit(main())
