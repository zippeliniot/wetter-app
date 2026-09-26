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
Zusaetzlich wird nach jedem Preis-Update ein kompakter Verlaufspunkt an
data/tanken_history.json angehaengt (Teil A WETTER-0007): bestehende Datei
per SFTP herunterladen (falls vorhanden), Punkt anhaengen, alle Punkte
aelter als RETAINED_DAYS (Vergleich ueber Zeitstempel) verwerfen, wieder
hochladen. Schlaegt das fehl, wird nur geloggt — data/tanken.json (der
Preis-Stand selbst) haengt nicht davon ab.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

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

HISTORY_LOCAL_FILE = "/tmp/climac_tanken_history.json"
HISTORY_REMOTE_NAME = "tanken_history.json"
RETAINED_DAYS = 3

OLD_PRICES_LOCAL_FILE = "/tmp/climac_tanken_old.json"

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


def _collect_prices(out_groups: list[dict]) -> dict:
    prices: dict = {}
    for group in out_groups:
        for st in group.get("stations", []):
            sid = st.get("id")
            if not sid:
                continue
            prices[sid] = {"e5": st.get("e5"), "e10": st.get("e10"), "diesel": st.get("diesel")}
    return prices


def _load_old_prices(sftp: ClimacSFTP) -> dict:
    """Laedt den aktuell live stehenden data/tanken.json-Stand herunter und baut
    daraus Station-ID -> {diesel, e5, e10, isOpen} als Fallback fuer Stationen,
    die in einem prices.php-Zyklus komplett fehlen. Schlaegt der Download fehl
    oder existiert die Datei noch nicht (erster Lauf ueberhaupt), wird ein leeres
    dict zurueckgegeben (kein Rueckfall moeglich, Verhalten wie bisher)."""
    old_prices: dict = {}
    if not sftp.download_file(REMOTE_NAME, OLD_PRICES_LOCAL_FILE):
        return old_prices
    try:
        with open(OLD_PRICES_LOCAL_FILE, "r") as fh:
            old_payload = json.load(fh)
        for group in old_payload.get("groups", []):
            for st in group.get("stations", []):
                sid = st.get("id")
                if sid:
                    old_prices[sid] = {
                        "diesel": st.get("diesel"),
                        "e5": st.get("e5"),
                        "e10": st.get("e10"),
                        "isOpen": st.get("isOpen"),
                    }
    except (json.JSONDecodeError, OSError):
        log.warning("tanken.json vorhanden, aber nicht lesbar — alter Preis-Stand unbenutzt")
        return {}
    return old_prices


def _append_history(sftp: ClimacSFTP, updated_at: str, prices: dict) -> None:
    """Haengt einen Verlaufspunkt an tanken_history.json an (Download, anhaengen,
    Trimmen auf RETAINED_DAYS ueber Zeitstempel, Upload). Existiert die Datei noch
    nicht (erster Lauf), wird sie frisch angelegt."""
    points: list = []
    if sftp.download_file(HISTORY_REMOTE_NAME, HISTORY_LOCAL_FILE):
        try:
            with open(HISTORY_LOCAL_FILE, "r") as fh:
                existing = json.load(fh)
            if isinstance(existing.get("points"), list):
                points = existing["points"]
        except (json.JSONDecodeError, OSError):
            log.warning("tanken_history.json vorhanden, aber nicht lesbar — neu angelegt")

    points.append({"t": updated_at, "prices": prices})

    cutoff = datetime.fromisoformat(updated_at) - timedelta(days=RETAINED_DAYS)
    kept = []
    for pt in points:
        try:
            t = datetime.fromisoformat(pt["t"])
        except (KeyError, TypeError, ValueError):
            continue
        if t >= cutoff:
            kept.append(pt)

    history = {"updated_at": updated_at, "retained_days": RETAINED_DAYS, "points": kept}
    with open(HISTORY_LOCAL_FILE, "w") as fh:
        json.dump(history, fh, separators=(",", ":"), ensure_ascii=False)

    remote = sftp.upload_file(HISTORY_LOCAL_FILE, HISTORY_REMOTE_NAME)
    log.info("Historie aktualisiert -> %s (%d Punkte)", remote, len(kept))


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

        with ClimacSFTP() as s:
            old_prices = _load_old_prices(s)

            out_groups = []
            for group in cache.get("groups", []):
                stations = group.get("stations", [])
                ids = [st["id"] for st in stations if st.get("id")]

                prices_by_id: dict = {}
                for chunk in _chunks(ids, CHUNK_SIZE):
                    prices_by_id.update(_prices_php(api_key, chunk))

                full_stations = []
                for st in stations:
                    p = prices_by_id.get(st["id"])
                    if p is None:
                        fallback = old_prices.get(st["id"], {})
                        log.warning(
                            "Station %s (%s) fehlt komplett in prices.php-Antwort — "
                            "Fallback auf letzten bekannten Preis",
                            st["id"], st.get("name"),
                        )
                        full_stations.append({
                            **st,
                            "isOpen": fallback.get("isOpen", False),
                            "diesel": fallback.get("diesel"),
                            "e5": fallback.get("e5"),
                            "e10": fallback.get("e10"),
                        })
                    else:
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

            remote = s.upload_file(OUT_FILE, REMOTE_NAME)
            log.info("Upload OK -> %s", remote)

            try:
                _append_history(s, payload["updated_at"], _collect_prices(out_groups))
            except Exception:
                log.exception("Historie-Update fehlgeschlagen (tanken.json bleibt unberuehrt)")

        log.info("=== export_tanken_prices done ===")
        return 0
    except Exception:
        log.exception("export_tanken_prices FEHLGESCHLAGEN")
        return 1


if __name__ == "__main__":
    sys.exit(main())
