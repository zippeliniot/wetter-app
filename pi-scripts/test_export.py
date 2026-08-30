#!/usr/bin/env python3
"""test_export.py — End-to-End-Test der drei Export-Scripts.

  1. fuehrt export_live / export_daily / export_history nacheinander aus
  2. prueft: Exit-Code 0, lokale JSON valide, Datei liegt danach auf dem SFTP
     und ist dort valides JSON
  3. Zusammenfassung: live-Werte (sw40/at/ah), Monatsdatei-Tage, history-Jahre

Exit-Code 0 = alles gruen, sonst 1.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta

from climac_sftp import ClimacSFTP

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

MONTH_KEY = (datetime.now() - timedelta(days=1)).strftime("%Y-%m")

# name, lokale Datei, remote-Dateiname, remote-subdir
JOBS = [
    ("export_live.py", "/tmp/climac_live.json", "live.json", None),
    ("export_daily.py", f"/tmp/climac_{MONTH_KEY}.json", f"{MONTH_KEY}.json", "months"),
    ("export_history.py", "/tmp/climac_history.json", "history.json", None),
]

GREEN, RED, DIM, RST = "\033[32m", "\033[31m", "\033[2m", "\033[0m"


def ok(msg: str) -> None:
    print(f"  {GREEN}OK{RST}  {msg}")


def fail(msg: str) -> None:
    print(f"  {RED}FAIL{RST}  {msg}")


def run_script(name: str) -> bool:
    print(f"\n{DIM}--- {name} ---{RST}")
    r = subprocess.run([sys.executable, f"{SCRIPT_DIR}/{name}"],
                       capture_output=True, text=True)
    for line in (r.stdout + r.stderr).splitlines():
        print(f"  {DIM}{line}{RST}")
    if r.returncode != 0:
        fail(f"{name} Exit-Code {r.returncode}")
        return False
    ok(f"{name} Exit-Code 0")
    return True


def load_local(path: str):
    try:
        with open(path) as fh:
            doc = json.load(fh)
        ok(f"lokale JSON valide: {path}")
        return doc
    except (OSError, ValueError) as e:
        fail(f"lokale JSON ungueltig ({path}): {e}")
        return None


def load_remote(remote_name: str, subdir):
    tmp = f"/tmp/_verify_{remote_name}"
    with ClimacSFTP() as s:
        found = s.download_file(remote_name, tmp, subdir=subdir)
    if not found:
        fail(f"remote Datei fehlt: {remote_name}")
        return None
    try:
        with open(tmp) as fh:
            doc = json.load(fh)
        loc = f"data/{subdir + '/' if subdir else ''}{remote_name}"
        ok(f"remote JSON valide: {loc}")
        return doc
    except (OSError, ValueError) as e:
        fail(f"remote JSON ungueltig ({remote_name}): {e}")
        return None


def main() -> int:
    all_ok = True
    docs: dict = {}

    for name, local_path, remote_name, subdir in JOBS:
        if not run_script(name):
            all_ok = False
            continue
        local_doc = load_local(local_path)
        remote_doc = load_remote(remote_name, subdir)
        if local_doc is None or remote_doc is None:
            all_ok = False
        if local_doc is not None and remote_doc is not None and local_doc != remote_doc:
            fail(f"{name}: lokale und remote JSON unterscheiden sich")
            all_ok = False
        elif local_doc is not None and remote_doc is not None:
            ok(f"{name}: lokal == remote")
        docs[name] = remote_doc or local_doc

    print(f"\n{DIM}=== Zusammenfassung ==={RST}")

    live = docs.get("export_live.py") or {}
    print(f"  live.json      t={live.get('t')}  "
          f"sw40={live.get('sw40')}  at={live.get('at')}  ah={live.get('ah')}")

    month = docs.get("export_daily.py") or {}
    days = [r[0] for r in month.get("data", [])]
    print(f"  {MONTH_KEY}.json  Monat={month.get('m')}  "
          f"Tage={len(days)}  {days if len(days) <= 12 else str(days[:12]) + '...'}")

    hist = docs.get("export_history.py") or {}
    years = hist.get("years", {})
    sw40y = {y: sum(1 for v in vals if v is not None)
             for y, vals in years.get("sw40", {}).items()}
    swgry = {y: sum(1 for v in vals if v is not None)
             for y, vals in years.get("swgr", {}).items()}
    refn = sum(1 for v in hist.get("ref", []) if v is not None)
    print(f"  history.json   updated={hist.get('updated')}  "
          f"summer_threshold={hist.get('summer_threshold')}  ref={refn}/365")
    print(f"                 sw40 Jahre (Tage): {sw40y}")
    print(f"                 swgr Jahre (Tage): {swgry}")

    print()
    if all_ok:
        print(f"{GREEN}ALLE TESTS BESTANDEN{RST}")
        return 0
    print(f"{RED}TESTS FEHLGESCHLAGEN{RST}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
