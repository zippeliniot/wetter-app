#!/usr/bin/env python3
"""deploy_web.py — Frontend der Wetter-App per SFTP nach IONOS (Webroot).

Ziel = credentials.sftp_ionos_wetter.path (= /Gronenberg/Wetter_1, das Webroot).
Nur Frontend-Dateien; data/ bespielt die Export-Pipeline.

  --dry-run      nur anzeigen, was hochgeladen wuerde
  --only a,b     nur diese (Pfade ab Repo-Root)
"""
from __future__ import annotations

import argparse
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

WEB_FILES = [
    "index.html", "CNAME",
    "js/config.js", "js/api.js", "js/utils.js", "js/ui.js",
    "js/charts.js", "js/main.js", "js/seewasser.js", "js/blitz.js",
    "js/regen.js",
]


def collect(only):
    names = [s.strip() for s in only.split(",")] if only else WEB_FILES
    out = []
    for rel in names:
        p = os.path.join(REPO, rel)
        if not os.path.isfile(p):
            print(f"  !! fehlt lokal, uebersprungen: {rel}")
            continue
        out.append((rel, p, os.path.getsize(p)))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Wetter-App Frontend -> IONOS")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", help="Kommagetrennte Teilliste (Pfade ab Repo-Root)")
    args = ap.parse_args(argv)

    plan = collect(args.only)
    if not plan:
        print("Nichts zu tun.")
        return 1

    total = sum(s for _, _, s in plan)
    print(f"\n{len(plan)} Datei(en), {total} B -> IONOS Webroot:")
    for rel, _, s in plan:
        print(f"  {rel:<22} {s:>7} B")

    if args.dry_run:
        print("\n--dry-run: nichts uebertragen.")
        return 0

    from climac_sftp import ClimacSFTP

    with ClimacSFTP() as s:
        print(f"\nSFTP {s.user}@{s.host}  base={s.base}")
        for rel, p, _ in plan:
            print(f"  OK  {s.upload_raw(p, rel)}")
    print("\nDeploy fertig.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
