#!/usr/bin/env python3
"""export_live.py — aktuelle Messwerte -> SFTP.

Laeuft alle 15 Minuten.

  sw40 : Seewasser 40 cm  (Union mehrerer Measurement-Namen)
  swgr : Seewasser Grund  (Union mehrerer Measurement-Namen)
  at   : sensor.gw2000a_outdoor_temperature
  ah   : sensor.gw2000a_humidity
  bld  : sensor.gw2000a_lightning_strike_distance_3
  blt  : sensor.gw2000a_last_lightning_strike_3
  bln  : sensor.gw2000a_lightning_strikes_3

sw40/swgr: Zeitfenster -3h; wenn leer Fallback -7d + last() (Sensor kann laenger
offline sein). Zusaetzlich "sw40_age"/"swgr_age" in Minuten (Alter des letzten
Werts, null wenn nichts gefunden).

Ausgabe /tmp/climac_live.json  ->  Upload data/live.json
  {"t":"2026-08-30T12:00Z","sw40":20.5,"sw40_age":12,"swgr":20.9,"swgr_age":12,
   "at":19.8,"ah":83,"bld":null,"blt":null,"bln":null}
"""
from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone

from influxdb_client import InfluxDBClient

from climac_sftp import ClimacSFTP, get_influx_config

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, "logs", "export_live.log")
OUT_FILE = "/tmp/climac_live.json"
REMOTE_NAME = "live.json"

# key -> config
#   m     : Measurement-Namen (Union; juengster Punkt gewinnt)
#   nd    : Nachkommastellen (0 -> int)
#   range : normales Zeitfenster fuer last()
#   track : True -> Fallback -7d wenn leer + Feld "<key>_age" (Minuten)
SENSORS = {
    "sw40": {
        "m": ["sensor.seewasser_temp_101_40cm",
              "sensor.temperature_sensor_101_40_cm_temperature"],
        "nd": 1, "range": "-3h", "track": True,
    },
    "swgr": {
        "m": ["sensor.seewasser_temp_102_grund_2",
              "sensor.seewasser_temp_102_grund",
              "sensor.temperature_sensor_102_grund_temperature"],
        "nd": 1, "range": "-3h", "track": True,
    },
    "at":  {"m": ["sensor.gw2000a_outdoor_temperature"], "nd": 1, "range": "-30m"},
    "ah":  {"m": ["sensor.gw2000a_humidity"], "nd": 0, "range": "-30m"},
    "bld": {"m": ["sensor.gw2000a_lightning_strike_distance_3"], "nd": 0, "range": "-30m"},
    "blt": {"m": ["sensor.gw2000a_last_lightning_strike_3"], "nd": 0, "range": "-30m"},
    "bln": {"m": ["sensor.gw2000a_lightning_strikes_3"], "nd": 0, "range": "-30m"},
}

log = logging.getLogger("export_live")


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


def _flux(measurements: list[str], rng: str) -> str:
    mfilter = " or ".join(f'r._measurement == "{e}"' for e in measurements)
    return f'''
from(bucket: "{INFLUX["bucket"]}")
  |> range(start: {rng})
  |> filter(fn: (r) => r._field == "value" and ({mfilter}))
  |> last()
  |> keep(columns: ["_measurement", "_value", "_time"])
'''


def _query_measurements(client: InfluxDBClient, measurements: list[str], rng: str) -> dict:
    """-> {measurement: (value, time)} — letzter Punkt je Measurement im Zeitfenster."""
    out = {}
    tables = client.query_api().query(_flux(measurements, rng), org=INFLUX["org"])
    for table in tables:
        for rec in table.records:
            v = rec["_value"]
            if v is None:
                continue
            out[rec["_measurement"]] = (v, rec["_time"])
    return out


def query_live(client: InfluxDBClient) -> dict:
    now = datetime.now(timezone.utc)
    result: dict = {}
    for key, cfg in SENSORS.items():
        found = _query_measurements(client, cfg["m"], cfg["range"])
        if not found and cfg.get("track"):
            found = _query_measurements(client, cfg["m"], "-7d")  # letzter bekannter Wert
        val, age = None, None
        if found:
            # juengsten Punkt ueber alle Measurement-Varianten waehlen
            _m, (v, t) = max(found.items(), key=lambda kv: kv[1][1])
            nd = cfg["nd"]
            val = int(round(v)) if nd == 0 else round(float(v), nd)
            age = int((now - t).total_seconds() // 60)
        result[key] = val
        if cfg.get("track"):
            result[key + "_age"] = age
    return result


def main() -> int:
    setup_logging()
    log.info("=== export_live start ===")
    try:
        with InfluxDBClient(url=INFLUX["url"], token=INFLUX["token"],
                            org=INFLUX["org"], timeout=60_000) as client:
            values = query_live(client)

        payload = {"t": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")}
        payload.update(values)

        with open(OUT_FILE, "w") as fh:
            json.dump(payload, fh, separators=(",", ":"), allow_nan=False)

        meas = {k: v for k, v in values.items() if not k.endswith("_age")}
        present = [k for k, v in meas.items() if v is not None]
        missing = [k for k, v in meas.items() if v is None]
        log.info("Werte: %s", json.dumps(payload, separators=(",", ":")))
        log.info("vorhanden: %s / fehlend: %s",
                 ",".join(present) or "-", ",".join(missing) or "-")

        with ClimacSFTP() as s:
            remote = s.upload_file(OUT_FILE, REMOTE_NAME)
        log.info("Upload OK -> %s", remote)
        log.info("=== export_live done ===")
        return 0
    except Exception:
        log.exception("export_live FEHLGESCHLAGEN")
        return 1


INFLUX = get_influx_config()

if __name__ == "__main__":
    sys.exit(main())
