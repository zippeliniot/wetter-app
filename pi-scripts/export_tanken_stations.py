#!/usr/bin/env python3
"""export_tanken_stations.py — taeglicher Tankerkoenig-Stationsabruf -> SFTP.

Laeuft 1x taeglich (00:10, nach dem Daily-Export um 00:05).

Ruft fuer jede Gruppe in GROUPS list.php auf (Umkreissuche INKL. Preisen),
schreibt die Stations-Stammdaten (id, name, brand, street, houseNumber,
postCode, place, lat, lng, dist) in einen lokalen, nicht-oeffentlichen Cache
(/opt/climac/data/tanken_stations_cache.json), damit export_tanken_prices.py
alle 15 Minuten nur noch die leichten prices.php-Calls machen muss.

Erzeugt direkt danach data/tanken.json mit den frisch geholten Preisen aus
derselben list.php-Antwort und laedt sie per SFTP hoch.

Key kommt aus der SQLite-Credential-DB (Tabelle `credentials`, Feld `secret`),
siehe climac_sftp.get_credential(). Kein Hardcode.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime

from climac_sftp import ClimacSFTP, get_credential

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, "logs", "export_tanken_stations.log")

TANKERKOENIG_CRED_ID = "tankerkoenig_api"
BASE_URL = "https://creativecommons.tankerkoenig.de/json/"
ATTRIBUTION = "Daten von Tankerkoenig (https://creativecommons.tankerkoenig.de)"

STATIONS_CACHE_FILE = "/opt/climac/data/tanken_stations_cache.json"
OUT_FILE = "/tmp/climac_tanken.json"
REMOTE_NAME = "tanken.json"

# Von April vorgegeben, aktuell nur eine Gruppe, als Liste fuer spaetere Erweiterung.
GROUPS = [
    {"name": "OH1", "lat": 54.0441, "lng": 10.7080, "radius_km": 5.0, "desc": "Gronenberg 5 km"},
]

log = logging.getLogger("export_tanken_stations")


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


def _get_api_key() -> str:
    cred = get_credential(TANKERKOENIG_CRED_ID)
    key = cred.get("secret")
    if not key:
        raise RuntimeError(f"Credential '{TANKERKOENIG_CRED_ID}': secret (API-Key) leer")
    return key


def _list_php(api_key: str, group: dict) -> list[dict]:
    params = {
        "lat": group["lat"],
        "lng": group["lng"],
        "rad": min(group["radius_km"], 25.0),
        "type": "all",
        "sort": "dist",
        "apikey": api_key,
    }
    url = f"{BASE_URL}list.php?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if not payload.get("ok"):
        raise RuntimeError(f"list.php fehlgeschlagen fuer Gruppe {group['name']}: {payload}")
    return payload.get("stations", [])


def _station_master(st: dict) -> dict:
    return {
        "id": st.get("id"),
        "name": st.get("name"),
        "brand": st.get("brand"),
        "street": st.get("street"),
        "houseNumber": st.get("houseNumber"),
        "postCode": st.get("postCode"),
        "place": st.get("place"),
        "lat": st.get("lat"),
        "lng": st.get("lng"),
        "dist": st.get("dist"),
    }


def _station_full(st: dict) -> dict:
    full = _station_master(st)
    full.update({
        "isOpen": bool(st.get("isOpen")),
        "diesel": st.get("diesel"),
        "e5": st.get("e5"),
        "e10": st.get("e10"),
    })
    return full


def main() -> int:
    setup_logging()
    log.info("=== export_tanken_stations start ===")
    try:
        api_key = _get_api_key()

        cache_groups = []
        out_groups = []
        for group in GROUPS:
            stations = _list_php(api_key, group)
            log.info("Gruppe %s: %d Stationen", group["name"], len(stations))

            cache_groups.append({
                **{k: group[k] for k in ("name", "lat", "lng", "radius_km", "desc")},
                "stations": [_station_master(st) for st in stations],
            })
            out_groups.append({
                **{k: group[k] for k in ("name", "lat", "lng", "radius_km", "desc")},
                "stations": [_station_full(st) for st in stations],
            })

        now_local = datetime.now().astimezone().isoformat(timespec="seconds")

        with open(STATIONS_CACHE_FILE, "w") as fh:
            json.dump({"cached_at": now_local, "groups": cache_groups}, fh,
                      separators=(",", ":"), ensure_ascii=False)
        log.info("Stations-Cache geschrieben -> %s", STATIONS_CACHE_FILE)

        payload = {
            "updated_at": now_local,
            "attribution": ATTRIBUTION,
            "groups": out_groups,
        }
        with open(OUT_FILE, "w") as fh:
            json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)

        with ClimacSFTP() as s:
            remote = s.upload_file(OUT_FILE, REMOTE_NAME)
            log.info("Upload OK -> %s", remote)

        log.info("=== export_tanken_stations done ===")
        return 0
    except Exception:
        log.exception("export_tanken_stations FEHLGESCHLAGEN")
        return 1


if __name__ == "__main__":
    sys.exit(main())
