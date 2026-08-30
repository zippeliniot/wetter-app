#!/usr/bin/env bash
# Installiert die CLIMAC-Wetter-Export Timer als System-Units.
# Aufruf:  sudo ./install.sh
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DST="/etc/systemd/system"

UNITS=(
  climac-live-export.service    climac-live-export.timer
  climac-daily-export.service   climac-daily-export.timer
  climac-history-export.service climac-history-export.timer
)

for u in "${UNITS[@]}"; do
  install -m 0644 "$SRC/$u" "$DST/$u"
  echo "installiert: $DST/$u"
done

systemctl daemon-reload

for t in climac-live-export climac-daily-export climac-history-export; do
  systemctl enable --now "$t.timer"
  echo "aktiviert:   $t.timer"
done

echo
systemctl list-timers 'climac-*-export.timer' --all --no-pager
