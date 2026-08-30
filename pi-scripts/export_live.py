#!/usr/bin/env python3
"""export_live.py — aktuelle Messwerte (letzte 30 Min) -> SFTP.

Laeuft alle 15 Minuten.

  sw40 : sensor.seewasser_temp_101_40cm
  swgr : sensor.seewasser_temp_102_grund_2
  at   : sensor.gw2000a_outdoor_temperature
  ah   : sensor.gw2000a_humidity
  bld  : sensor.gw2000a_lightning_strike_distance_3
  blt  : sensor.gw2000a_last_lightning_strike_3
  bln  : sensor.gw2000a_lightning_strikes_3

Ausgabe /tmp/climac_live.json  ->  Upload data/live.json
  {"t":"2026-08-30T12:00Z","sw40":20.5,"swgr":20.9,"at":19.8,"ah":83,
   "bld":null,"blt":null,"bln":null}
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

# key -> (entity_id, ndigits)   ndigits=0 -> int
SENSORS = {
    "sw40": ("sensor.seewasser_temp_101_40cm", 1),
    "swgr": ("sensor.seewasser_temp_102_grund_2", 1),
    "at": ("sensor.gw2000a_outdoor_temperature", 1),
    "ah": ("sensor.gw2000a_humidity", 0),
    "bld": ("sensor.gw2000a_lightning_strike_distance_3", 0),
    "blt": ("sensor.gw2000a_last_lightning_strike_3", 0),
    "bln": ("sensor.gw2000a_lightning_strikes_3", 0),
}
BY_ENTITY = {eid: (key, nd) for key, (eid, nd) in SENSORS.items()}
SENSORS_ENTITIES = [eid for eid, _ in SENSORS.values()]

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


def _flux() -> str:
    mfilter = " or ".join(f'r._measurement == "{e}"' for e in SENSORS_ENTITIES)
    return f'''
from(bucket: "{INFLUX["bucket"]}")
  |> range(start: -30m)
  |> filter(fn: (r) => r._field == "value" and ({mfilter}))
  |> last()
  |> keep(columns: ["_measurement", "_value"])
'''


def query_live(client: InfluxDBClient) -> dict:
    values = {key: None for key in SENSORS}
    tables = client.query_api().query(_flux(), org=INFLUX["org"])
    for table in tables:
        for rec in table.records:
            entity = rec["_measurement"]
            if entity not in BY_ENTITY:
                continue
            key, ndigits = BY_ENTITY[entity]
            v = rec["_value"]
            if v is None:
                continue
            values[key] = int(round(v)) if ndigits == 0 else round(float(v), ndigits)
    return values


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

        present = [k for k, v in values.items() if v is not None]
        log.info("Werte: %s", json.dumps(payload, separators=(",", ":")))
        log.info("vorhanden: %s / fehlend: %s",
                 ",".join(present) or "-",
                 ",".join(k for k in values if values[k] is None) or "-")

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
