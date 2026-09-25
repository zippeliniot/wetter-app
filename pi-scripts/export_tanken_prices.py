#!/usr/bin/env python3
"""export_tanken_prices.py — Tankerkoenig-Preis-Update -> SFTP.

Laeuft alle 15 Minuten (wie climac-live-export).

Liest den lokalen Stations-Cache aus export_tanken_stations.py
(/opt/climac/data/tanken_stations_cache.json), ruft fuer die gecachten
Stations-IDs prices.php auf (leichter Call, keine erneute Umkreissuche) und
aktualisiert NUR Preise/Status + updated_at in data/tanken.json.

Fehlt der Cache (noch kein taeglicher Lauf gelaufen): sauber ueberspringen
und loggen, kein Crash (Exit 0).

Tankerkoenig erlaubt max. 10 Stations-IDs je prices.php-Call -> Chunking.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime

from climac_sftp import ClimacSFTP
from export_tanken_stations import (
    ATTRIBUTION,
    BASE_URL,
    OUT_FILE,
    REMOTE_NAME,
    STATIONS_CACHE_FILE,
    _get_api_key,
    _num_or_none,
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, "logs", "export_tanken_prices.log")

CHUNK_SIZE = 10

log = logging.getLogger("export_tanken_prices")


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


def _chunks(seq: list, size: int) -> list[list]:
    return [seq[i:i + size] for i in range(0, len(seq), size)]


def _prices_php(api_key: str, ids: list[str]) -> dict:
    params = {"ids": ",".join(ids), "apikey": api_key}
    url = f"{BASE_URL}prices.php?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if not payload.get("ok"):
        raise RuntimeError(f"prices.php fehlgeschlagen: {payload}")
    return payload.get("prices", {})


def main() -> int:
    setup_logging()
    log.info("=== export_tanken_prices start ===")

    if not os.path.exists(STATIONS_CACHE_FILE):
        log.info("Kein Stations-Cache vorhanden (%s) — noch kein taeglicher Lauf. Uebersprungen.",
                  STATIONS_CACHE_FILE)
        return 0

    try:
        with open(STATIONS_CACHE_FILE, "r") as fh:
            cache = json.load(fh)

        api_key = _get_api_key()

        out_groups = []
        for group in cache.get("groups", []):
            stations = group.get("stations", [])
            ids = [st["id"] for st in stations if st.get("id")]

            prices_by_id: dict = {}
            for chunk in _chunks(ids, CHUNK_SIZE):
                prices_by_id.update(_prices_php(api_key, chunk))

            full_stations = []
            for st in stations:
                p = prices_by_id.get(st["id"], {})
                full_stations.append({
                    **st,
                    "isOpen": p.get("status") == "open",
                    "diesel": _num_or_none(p.get("diesel")),
                    "e5": _num_or_none(p.get("e5")),
                    "e10": _num_or_none(p.get("e10")),
                })

            out_groups.append({
                "name": group.get("name"),
                "lat": group.get("lat"),
                "lng": group.get("lng"),
                "radius_km": group.get("radius_km"),
                "desc": group.get("desc"),
                "stations": full_stations,
            })
            log.info("Gruppe %s: %d Preise aktualisiert", group.get("name"), len(full_stations))

        payload = {
            "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "attribution": ATTRIBUTION,
            "groups": out_groups,
        }
        with open(OUT_FILE, "w") as fh:
            json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)

        with ClimacSFTP() as s:
            remote = s.upload_file(OUT_FILE, REMOTE_NAME)
            log.info("Upload OK -> %s", remote)

        log.info("=== export_tanken_prices done ===")
        return 0
    except Exception:
        log.exception("export_tanken_prices FEHLGESCHLAGEN")
        return 1


if __name__ == "__main__":
    sys.exit(main())
